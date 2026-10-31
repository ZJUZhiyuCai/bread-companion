import {
  Box3,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { PhonePose } from '../RedPhone';
import { CoilCord } from './cord';
import type { PhoneLayout } from './layouts';

/** Written by scripts/3d/build_companion.py --output public/companion/3d. */
export const PHONE_MODEL_URL = '/companion/3d/bread-phone.glb';

/**
 * The lamp the plush photo was taken under — warm, high on the left, in front — plus a cream bounce
 * from 面包's side and a warm rim from behind that keeps the silhouette on a dark page. Directions match
 * the Blender preview rig (Blender x,y,z → three x,z,-y).
 *
 * Tuned against review/actual-*.png: the first pass was a bright, orange, hard-plastic red. Less key,
 * more sky, a softer coat and a quieter room reflection give a deep, warm lacquer whose highlights are
 * broad and soft, like the light on the photo's fur.
 */
const LOOK = {
  exposure: 0.94,
  sky: 0.92,
  key: 1.38,
  fill: 0.32,
  rim: 0.52,
  fur: 0.3,
  env: 0.46,
  /** baked shades on the table: under the base, and the handset's on the deck */
  contact: 0.78,
  deck: 0.38,
};
const KEY_DIR = new Vector3(-0.55, 0.75, 0.7).normalize();
const FILL_DIR = new Vector3(0.9, 0.5, -0.25).normalize();
const RIM_DIR = new Vector3(0.25, 0.55, -0.8).normalize();
const FUR_DIR = new Vector3(-1, 0.15, -0.2).normalize();

/** World units per unit of the host drawing. Arbitrary; only keeps the camera numbers readable. */
const K = 0.001;
const FOV = 22;
/**
 * A lifted handset comes this far toward the viewer: held in front of the photo, and a little larger
 * than in the cradle, the way something brought to your face fills more of the picture.
 */
const LIFT_Z = 0.1;
/** How far a lifted handset leans its top toward the viewer, so its shape — grip and two bells — reads. */
const LIFT_LEAN = 0.38;

/** The drawn phone's rhythm: dialling 1.9 s, then a ring every 2.2 s. */
const LIFT_MS = 950;
const HOVER_MS = 320;
const HOLD_MS = 560;
const PLUNGE_MS = 220;
const LAND_MS = 320;
const GREET_MS = 1100;
const DIAL_MS = 1900;
const RING_MS = 2200;

/** Phone-space offsets, in metres (the model is 0.125 m wide). */
const HOVER_SHIFT = new Vector3(0, 0.0085, 0.0045);
const HOLD_SHIFT = new Vector3(0.0014, 0.0024, -0.001);
const PLUNGE_RISE = 0.0042;
const COIL_R = 0.0048;
const TUBE_R = 0.0019;

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export interface PhoneInput {
  pose: PhonePose;
  /** Hover or keyboard focus on the phone button: the handset comes up a little in its cradle. */
  lift: boolean;
  reducedMotion: boolean;
  /** Once, when the phone first appears on the home page: the handset gives a small hop, then rests. */
  greet?: boolean;
}

interface Pose {
  pos: Vector3;
  quat: Quaternion;
}

interface Rig {
  handset: Object3D;
  rest: Pose;
  hold: Pose;
  raised: Pose & { arc: number };
  wheel: Object3D | null;
  wheelRest: Quaternion;
  axis: Vector3;
  plungers: Object3D | null;
  plungerRest: Vector3;
  cordRoot: Object3D | null;
  cordTip: Object3D | null;
  cordRest: number;
  width: number;
  /** The handset's soft shade on the deck; fades as it leaves the cradle. */
  deckShade: MeshBasicMaterial | null;
}

/* -------------------------------------------------------------------------- */
/* The model's bytes are fetched once per page and parsed per stage, so each  */
/* stage owns (and frees) its own GPU resources while the network sees one    */
/* request — the home page's fetch is what the call stage then reuses.        */
/* -------------------------------------------------------------------------- */

let modelBytes: Promise<ArrayBuffer> | null = null;

export function fetchPhoneModel(): Promise<ArrayBuffer> {
  if (!modelBytes) {
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 10_000);
    const p = fetch(PHONE_MODEL_URL, { credentials: 'same-origin', signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`phone model: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .finally(() => window.clearTimeout(deadline));
    modelBytes = p;
    // a failure is not remembered: the next stage may try again
    p.catch(() => {
      if (modelBytes === p) modelBytes = null;
    });
  }
  return modelBytes;
}

/**
 * One phone on one transparent canvas. Draws only when something is moving: a resting phone costs no
 * frames at all, nor does one that is off screen or in a background tab.
 */
export class PhoneEngine {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 10);
  /** Tipped toward the viewer and scaled to the drawing; the cord lives here. */
  private readonly table = new Group();
  /** Turned on the table; the phone, its shadow and its contact shade live here. */
  private readonly turn = new Group();
  private readonly key = new DirectionalLight(0xffe3bc, LOOK.key);
  private readonly lights: DirectionalLight[] = [];
  private readonly textures: Texture[] = [];
  private readonly targets: WebGLRenderTarget[] = [];
  private readonly observers: { disconnect(): void }[] = [];
  private rig: Rig | null = null;
  private cord: CoilCord | null = null;

  private input: PhoneInput = { pose: 'rest', lift: false, reducedMotion: false };
  private lift = 0;
  private hover = 0;
  private hold = 0;
  private plunge = 0;
  private dialFrom = 0;
  private greetFrom = 0;
  private greeted = false;
  private landFrom = 0;
  private raf = 0;
  private last = 0;
  private onScreen = true;
  private disposed = false;

  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly dq = new Quaternion();
  private readonly ends = [new Vector3(), new Vector3()];
  private readonly drawn = [new Vector3(Number.NaN, 0, 0), new Vector3()];
  private readonly c1 = new Vector3();
  private readonly c2 = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: PhoneLayout,
    private readonly onLost: () => void,
  ) {
    // Throws when WebGL 2 can't be had; the caller keeps the drawn phone.
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!context) throw new Error('phone: WebGL 2 unavailable');
    try {
      this.renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (error) {
      // Three can throw after allocating driver resources but before returning
      // a renderer. We own the context even when no renderer can be disposed.
      context.getExtension('WEBGL_lose_context')?.loseContext();
      throw error;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = LOOK.exposure;
    // No shadow maps: on the real page their frustum showed as a hard grey slab. The table shades are
    // baked soft gradients instead — the same language as the photo's own soft shadow.
    this.renderer.shadowMap.enabled = false;

    try {
      canvas.addEventListener('webglcontextlost', this.lost);
      document.addEventListener('visibilitychange', this.wake);
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(this.resize);
        ro.observe(canvas);
        this.observers.push(ro);
      }
      if (typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver((entries) => {
          this.onScreen = entries.some((e) => e.isIntersecting);
          this.kick();
        });
        io.observe(canvas);
        this.observers.push(io);
      }

      const halfH = (layout.overlay.h * K) / 2;
      this.camera.position.set(0, 0, halfH / Math.tan((FOV * Math.PI) / 360));
      this.camera.lookAt(0, 0, 0);

      this.light();
      this.table.add(this.turn);
      this.scene.add(this.table);
    } catch (error) {
      // A failed environment/shader setup must release the context even though
      // the constructor never returns an instance to the React owner.
      this.dispose();
      throw error;
    }
  }

  /** Parse and set up. A result that arrives after dispose() is freed, never shown. */
  async load(bytes: ArrayBuffer): Promise<void> {
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    if (this.disposed) {
      disposeTree(gltf.scene);
      return;
    }
    try {
      this.mount(gltf.scene);
    } catch (err) {
      disposeTree(gltf.scene);
      throw err;
    }
    this.resize();
  }

  setInput(next: PhoneInput) {
    if (next.pose === 'dialing' && this.input.pose !== 'dialing') this.dialFrom = performance.now();
    if (next.greet && !this.greeted && !next.reducedMotion && next.pose === 'rest') {
      this.greetFrom = performance.now() + 420;
    }
    if (next.greet) this.greeted = true;
    this.input = { ...next };
    this.kick();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observers.forEach((o) => o.disconnect());
    document.removeEventListener('visibilitychange', this.wake);
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    disposeTree(this.scene);
    this.cord?.dispose();
    this.lights.forEach((l) => l.dispose());
    this.textures.forEach((t) => t.dispose());
    this.targets.forEach((target) => target.dispose());
    this.scene.environment = null;
    this.scene.clear();
    this.rig = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /* ---------------------------------------------------------------------- */

  private light() {
    // warm paper above, the wood of the table below: the undersides go a warm brown, never grey
    const sky = new HemisphereLight(0xfff0dc, 0x6b4a36, LOOK.sky);
    this.scene.add(sky);

    this.lights.push(this.key);
    this.scene.add(this.key, this.key.target);

    for (const [colour, strength, dir] of [
      [0xd8e4ff, LOOK.fill, FILL_DIR],
      [0xffcf9a, LOOK.rim, RIM_DIR],
      [0xffe2c0, LOOK.fur, FUR_DIR],
    ] as const) {
      const l = new DirectionalLight(colour, strength);
      l.position.copy(dir);
      this.lights.push(l);
      this.scene.add(l);
    }

    // A soft room to reflect, generated on the spot (nothing is downloaded): it is what makes the
    // lacquer read as lacquer — broad, quiet highlights — instead of plastic with one hot spot.
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    try {
      const target = pmrem.fromScene(room, 0.04);
      this.targets.push(target);
      this.scene.environment = target.texture;
    } finally {
      room.dispose();
      pmrem.dispose();
    }
    this.scene.environmentIntensity = LOOK.env;
  }

  private mount(root: Object3D) {
    const body = root.getObjectByName('phone_body');
    const handset = root.getObjectByName('handset');
    if (!body || !handset || !handset.parent) throw new Error('phone model: phone_body or handset missing');

    // The file's resting cord is for viewers of the .glb; here the cord follows the handset.
    const stored = root.getObjectByName('cord');
    if (stored) {
      stored.removeFromParent();
      disposeTree(stored);
    }
    restyle(root);

    root.updateMatrixWorld(true);
    const size = new Box3().setFromObject(body).getSize(new Vector3());
    const { base, yaw, pitch } = this.layout;
    const footprint = size.x * Math.cos(yaw) + size.z * Math.sin(Math.abs(yaw));
    this.table.scale.setScalar((base.width * K) / footprint);
    this.table.rotation.x = pitch;
    this.table.position.copy(this.toWorld(base.x, base.y));
    this.turn.rotation.y = yaw;
    this.turn.add(root);
    this.ground(size);
    const deckShade = this.deckShade(root, size);

    const anchor = this.table.position;
    this.key.target.position.copy(anchor);
    this.key.position.copy(anchor).addScaledVector(KEY_DIR, 1.2);

    this.scene.updateMatrixWorld(true);

    const rest: Pose = { pos: handset.position.clone(), quat: handset.quaternion.clone() };
    const wheel = root.getObjectByName('dial_wheel') ?? null;
    const axisNode = root.getObjectByName('dial_axis');
    const axis =
      wheel && axisNode ? axisNode.position.clone().sub(wheel.position).normalize() : new Vector3(0, 0.77, 0.64).normalize();
    const plungers = root.getObjectByName('plungers') ?? null;

    this.rig = {
      handset,
      rest,
      hold: {
        pos: rest.pos.clone().add(HOLD_SHIFT),
        quat: rest.quat
          .clone()
          .multiply(new Quaternion().setFromAxisAngle(Y, -0.09))
          .multiply(new Quaternion().setFromAxisAngle(Z, 0.03)),
      },
      raised: this.raisedPose(handset, rest),
      wheel,
      wheelRest: wheel ? wheel.quaternion.clone() : new Quaternion(),
      axis,
      plungers,
      plungerRest: plungers ? plungers.position.clone() : new Vector3(),
      cordRoot: root.getObjectByName('cord_root') ?? null,
      cordTip: root.getObjectByName('cord_tip') ?? null,
      cordRest: 0,
      width: size.x,
      deckShade,
    };

    if (this.rig.cordRoot && this.rig.cordTip) {
      // a shade darker than the body, as a rubber-sheathed cord is beside lacquer
      const material = new MeshPhysicalMaterial({
        name: 'cord_live',
        color: 0x8f1f19,
        roughness: 0.5,
        clearcoat: 0.25,
        clearcoatRoughness: 0.35,
        envMapIntensity: 0.4,
      });
      this.cord = new CoilCord(material);
      this.table.add(this.cord.mesh);
      this.cordEnds();
      this.rig.cordRest = this.ends[0].distanceTo(this.ends[1]);
      this.drawCord(true);
    }
  }

  /**
   * The phone's own shade on the table: tight and dark where the base meets it, fading within a finger's
   * width. The long soft cast toward the lower right and the red glow on the table are the drawn phone's
   * floor layer, which stays on under the canvas — the same shadows the photo and the 2D phone use.
   */
  private ground(size: Vector3) {
    const map = shadeTexture();
    if (!map) return;
    this.textures.push(map);
    const contact = new Mesh(
      new PlaneGeometry(size.x * 1.16, size.z * 1.22),
      new MeshBasicMaterial({ map, transparent: true, opacity: LOOK.contact, depthWrite: false, toneMapped: false }),
    );
    contact.name = 'contact_shade';
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(size.x * 0.02, 0.0003, size.z * 0.03);
    contact.renderOrder = -1;
    this.turn.add(contact);
  }

  /** The handset's shade on the deck between the saddles — gone as soon as it is picked up. */
  private deckShade(root: Object3D, size: Vector3): MeshBasicMaterial | null {
    const mark = root.getObjectByName('deck_mark');
    const map = this.textures.find((t) => t.name === 'bread-shade');
    if (!mark?.parent || !map) return null;
    const material = new MeshBasicMaterial({
      map,
      transparent: true,
      opacity: LOOK.deck,
      depthWrite: false,
      toneMapped: false,
    });
    const shade = new Mesh(new PlaneGeometry(size.x * 0.92, size.z * 0.36), material);
    shade.name = 'deck_shade';
    shade.rotation.x = -Math.PI / 2;
    shade.position.copy(mark.position);
    mark.parent.add(shade);
    return material;
  }

  /**
   * Where the handset goes when the line opens, in its parent's space.
   *
   * With a cheek in the layout it is held the way a phone is held to a face: the grip along the given
   * screen angle, the two bells opening toward 面包, and its whole profile — grip and both bells — turned
   * to the viewer, leaning its top out a little. Seen edge-on (the first pass) a handset is just a red
   * stick; seen like this it is unmistakably a telephone being listened to.
   *
   * Without a cheek: just up out of the cradle.
   */
  private raisedPose(handset: Object3D, rest: Pose): Pose & { arc: number } {
    const cheek = this.layout.cheek;
    if (!cheek) {
      return {
        pos: rest.pos.clone().add(new Vector3(0, 0.028, 0.006)),
        quat: rest.quat.clone().multiply(new Quaternion().setFromAxisAngle(Z, 0.2)),
        arc: 0.01,
      };
    }
    const parent = handset.parent!;
    const a = (cheek.angle * Math.PI) / 180;
    // local +X (toward the mouthpiece) along the screen angle
    const along = new Vector3(Math.cos(a), -Math.sin(a), 0);
    // local +Y (the top of the grip) points away from the face, so the bells open toward it…
    const up = new Vector3(along.y, -along.x, 0);
    if (up.x < 0) up.negate();
    // …leaning out toward the viewer, so the shape reads
    up.multiplyScalar(Math.cos(LIFT_LEAN)).add(new Vector3(0, 0, Math.sin(LIFT_LEAN))).normalize();
    const out = new Vector3().crossVectors(along, up);
    const world = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(along, up, out));
    const quat = parent.getWorldQuaternion(new Quaternion()).invert().multiply(world);
    const pos = parent.worldToLocal(this.toWorld(cheek.x, cheek.y).setZ(LIFT_Z));
    return { pos, quat, arc: pos.distanceTo(rest.pos) * 0.3 };
  }

  /* ---------------------------------------------------------------------- */

  private step(dt: number, now: number): boolean {
    const rig = this.rig!;
    const { pose, lift, reducedMotion: still } = this.input;
    if (still) { this.greetFrom = 0; this.landFrom = 0; }

    const goal = {
      lift: pose === 'lifted' ? 1 : 0,
      hold: pose === 'hold' ? 1 : 0,
      hover: lift && pose === 'rest' ? 1 : 0,
      plunge: pose === 'lifted' ? 1 : 0,
    };
    const wasUp = this.lift > 0;
    this.lift = still ? goal.lift : toward(this.lift, goal.lift, dt / LIFT_MS);
    this.hold = still ? goal.hold : toward(this.hold, goal.hold, dt / HOLD_MS);
    this.hover = still ? goal.hover : toward(this.hover, goal.hover, dt / HOVER_MS);
    this.plunge = still ? goal.plunge : toward(this.plunge, goal.plunge, dt / PLUNGE_MS);
    // the moment it touches down in the cradle: a small settle, and the buttons clack down
    if (wasUp && this.lift === 0 && !still) this.landFrom = now;
    let busy =
      this.lift !== goal.lift || this.hold !== goal.hold || this.hover !== goal.hover || this.plunge !== goal.plunge;

    // Dialling and ringing belong to `connecting` only — the real phase, never a timer of our own.
    let dial = 0;
    let shake = 0;
    let rattle = 0;
    if (pose === 'dialing' && !still) {
      const t = now - this.dialFrom;
      dial = dialAngle(t);
      if (t > DIAL_MS) {
        const p = ((t - DIAL_MS) % RING_MS) / RING_MS;
        if (p < 0.34) {
          // the bell: a fast, small tremor of the whole phone, the handset chattering in its cradle
          const amp = Math.sin((Math.PI * p) / 0.34);
          shake = Math.sin(t * 0.12) * amp * 0.02;
          rattle = Math.abs(Math.sin(t * 0.085)) * amp * 0.0018;
        }
      }
      busy = true;
    }
    this.turn.rotation.z = shake;

    // Once, on the home page: a small double hop, as if it had just made a sound. Never in a call.
    let hop = 0;
    if (this.greetFrom && !still && pose === 'rest') {
      const t = now - this.greetFrom;
      if (t >= GREET_MS) this.greetFrom = 0;
      else {
        busy = true;
        if (t > 0) hop = greetHop(t / GREET_MS);
      }
    }

    let settle = 0;
    if (this.landFrom) {
      const u = (now - this.landFrom) / LAND_MS;
      if (u >= 1) this.landFrom = 0;
      else {
        busy = true;
        settle = Math.sin(u * Math.PI * 2) * (1 - u) * (1 - u) * 0.0016;
      }
    }

    if (rig.wheel) rig.wheel.quaternion.setFromAxisAngle(rig.axis, -dial).multiply(rig.wheelRest);
    if (rig.plungers) {
      const rise = Math.max(ease(this.plunge), 0.45 * ease(this.hover), hop > 0 ? 0.3 : 0);
      rig.plungers.position.copy(rig.plungerRest).addScaledVector(Y, PLUNGE_RISE * rise);
    }

    // In the cradle: resting, a little askew on hold — and under the hand, lifted a finger's height and
    // tipped toward you, offered rather than nudged.
    const eh = ease(this.hold);
    const ev = ease(this.hover);
    const { p, q, dq } = this;
    p.copy(rig.rest.pos).lerp(rig.hold.pos, eh).addScaledVector(HOVER_SHIFT, ev);
    p.y += rattle + hop * 0.0055 + settle;
    q.copy(rig.rest.quat).slerp(rig.hold.quat, eh);
    q.multiply(dq.setFromAxisAngle(X, 0.16 * ev + hop * 0.08));
    q.multiply(dq.setFromAxisAngle(Z, -0.035 * ev - hop * 0.04));

    // Out of it: a small press down first, then up, then across, turning on the way — an arc that eases
    // into place at the cheek and, going back, drops the last bit into the cradle.
    const up = this.lift;
    if (up > 0) {
      const el = ease(up);
      const press = goal.lift === 1 && up < 0.14 ? Math.sin((Math.PI * up) / 0.14) * 0.0018 : 0;
      p.lerp(rig.raised.pos, el);
      p.y += Math.sin(Math.PI * el) * rig.raised.arc - press;
      q.slerp(rig.raised.quat, ease(Math.max(0, (up - 0.1) / 0.9)));
    }
    rig.handset.position.copy(p);
    rig.handset.quaternion.copy(q);

    if (rig.deckShade) {
      // the shade under the handset softens as it rises off the cradle and is gone once it is away
      const away = Math.min(1, ease(up) * 3 + ev * 0.35 + hop * 0.4);
      rig.deckShade.opacity = LOOK.deck * (1 - away);
    }

    this.drawCord(false);
    return busy;
  }

  private cordEnds() {
    const rig = this.rig!;
    this.scene.updateMatrixWorld();
    rig.cordRoot!.getWorldPosition(this.ends[0]);
    rig.cordTip!.getWorldPosition(this.ends[1]);
    this.table.worldToLocal(this.ends[0]);
    this.table.worldToLocal(this.ends[1]);
  }

  /** Rebuilt only when an end has actually moved. Worked out in the table's space, where y is up. */
  private drawCord(force: boolean) {
    const rig = this.rig;
    if (!rig || !this.cord || !rig.cordRoot || !rig.cordTip) return;
    this.cordEnds();
    const [a, b] = this.ends;
    if (!force && a.distanceToSquared(this.drawn[0]) < 1e-12 && b.distanceToSquared(this.drawn[1]) < 1e-12) return;
    this.drawn[0].copy(a);
    this.drawn[1].copy(b);

    const length = a.distanceTo(b);
    const w = rig.width;
    const yaw = this.layout.yaw;
    // out of the back of the body toward its right side, then sagging toward the table
    const floor = COIL_R + TUBE_R;
    this.c1.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(w * 0.45).add(a);
    this.c1.y = Math.max(floor, a.y - (w * 0.25 + length * 0.22));
    this.c2.copy(b);
    this.c2.y = Math.max(floor, b.y - (w * 0.22 + length * 0.32));
    const stretch = Math.sqrt(Math.min(1, Math.max(0.3, (rig.cordRest || length) / Math.max(length, 1e-6))));
    this.cord.update(a, this.c1, this.c2, b, COIL_R * stretch, TUBE_R);
  }

  /* ---------------------------------------------------------------------- */

  private toWorld(x: number, y: number) {
    const o = this.layout.overlay;
    return new Vector3((x - (o.x + o.w / 2)) * K, -(y - (o.y + o.h / 2)) * K, 0);
  }

  private canRun() {
    return !this.disposed && !!this.rig && this.onScreen && !document.hidden;
  }

  private kick = () => {
    if (this.raf || !this.canRun()) return;
    this.raf = requestAnimationFrame(this.frame);
  };

  private frame = (now: number) => {
    this.raf = 0;
    if (!this.canRun()) {
      this.last = 0;
      return;
    }
    const dt = this.last ? Math.min(64, now - this.last) : 16;
    this.last = now;
    try {
      const busy = this.step(dt, now);
      this.renderer.render(this.scene, this.camera);
      if (busy) this.raf = requestAnimationFrame(this.frame);
      else this.last = 0;
    } catch {
      this.last = 0;
      this.onLost();
    }
  };

  private resize = () => {
    if (this.disposed) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kick();
  };

  private wake = () => {
    if (!document.hidden) this.kick();
  };

  private lost = (e: Event) => {
    e.preventDefault();
    if (!this.disposed) this.onLost();
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Our own materials in place of whatever the exporter wrote, so the look doesn't depend on which glTF
 * extensions a given Blender emits: warm lacquer with a thin soft coat, matte ivory, brushed brass.
 */
function restyle(root: Object3D) {
  const made = new Map<string, Material>();
  const replaced = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as Material;
    const name = src.name.replace(/\.\d+$/, '');
    const vc = mesh.geometry.hasAttribute('color');
    const key = `${name}:${vc}`;
    let next = made.get(key);
    if (!next) {
      const created = look(name, vc);
      if (!created) return;
      made.set(key, created);
      next = created;
    }
    replaced.add(src);
    mesh.material = next;
  });
  replaced.forEach(disposeMaterial);
}

function look(name: string, vertexColors: boolean): Material | null {
  switch (name) {
    case 'm_lacquer':
      // A deep, warm lacquer: the body diffuses, a thin soft coat carries a broad sheen. Less specular
      // than the default, so a highlight is a glow across a curve, never a white plastic spot.
      return new MeshPhysicalMaterial({
        name,
        vertexColors,
        color: vertexColors ? 0xffffff : 0xb02a24,
        roughness: 0.48,
        specularIntensity: 0.52,
        specularColor: 0xffe2cc,
        clearcoat: 0.4,
        clearcoatRoughness: 0.34,
        envMapIntensity: 0.42,
      });
    case 'm_ivory':
      // the plush's own cream, matte like an old bakelite plate
      return new MeshPhysicalMaterial({
        name,
        vertexColors,
        color: vertexColors ? 0xffffff : 0xefe1c6,
        roughness: 0.58,
        specularIntensity: 0.5,
        clearcoat: 0.08,
        clearcoatRoughness: 0.45,
        envMapIntensity: 0.35,
      });
    case 'm_brass':
      return new MeshStandardMaterial({ name, color: 0xb8925c, metalness: 0.8, roughness: 0.4, envMapIntensity: 0.75 });
    default:
      return null;
  }
}

/**
 * A soft warm-brown shade, drawn on the spot: dense in the middle, a long gentle falloff, never a hard
 * edge. Stretched over a plane it becomes whatever oval the footprint needs.
 */
function shadeTexture(): CanvasTexture | null {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(42, 16, 8, 1)');
  grad.addColorStop(0.45, 'rgba(42, 16, 8, 0.72)');
  grad.addColorStop(0.75, 'rgba(42, 16, 8, 0.24)');
  grad.addColorStop(1, 'rgba(42, 16, 8, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.name = 'bread-shade';
  t.colorSpace = SRGBColorSpace;
  return t;
}

function disposeTree(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => m && disposeMaterial(m));
  });
}

function disposeMaterial(m: Material) {
  for (const value of Object.values(m)) {
    if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose();
  }
  m.dispose();
}

/**
 * Two digits dialled the way a finger dials them, in the drawn phone's 1.9 s: pulled round to the stop
 * (quick to start, slowing into it), a beat against the stop, then let go — the spring brings it back at
 * an even clockwork speed and it settles with a tiny knock. 152° and 96°, as on the drawn dial.
 */
const DIAL_STROKES: { deg: number; pull: number; hold: number; back: number; rest: number }[] = [
  { deg: 152, pull: 380, hold: 90, back: 470, rest: 110 },
  { deg: 96, pull: 300, hold: 80, back: 300, rest: 170 },
];

function dialAngle(ms: number): number {
  let t = ms;
  for (const s of DIAL_STROKES) {
    if (t < s.pull) return rad(s.deg * pullCurve(t / s.pull));
    t -= s.pull;
    if (t < s.hold) return rad(s.deg);
    t -= s.hold;
    if (t < s.back) return rad(s.deg * (1 - t / s.back));
    t -= s.back;
    if (t < s.rest) {
      // the knock at the end of the return
      const u = t / s.rest;
      return rad(-3.2 * Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u));
    }
    t -= s.rest;
  }
  return 0;
}

function pullCurve(u: number) {
  // fast off the mark, decelerating into the finger stop
  return 1 - (1 - Math.min(1, Math.max(0, u))) ** 2.4;
}

function rad(deg: number) {
  return (deg * Math.PI) / 180;
}

/** Two hops, the second smaller, over the greeting: 0 → 1 → 0 → 0.45 → 0. */
function greetHop(u: number) {
  if (u < 0.42) return Math.sin((Math.PI * u) / 0.42) ** 2;
  if (u < 0.72) return 0.45 * Math.sin((Math.PI * (u - 0.42)) / 0.3) ** 2;
  return 0;
}

function toward(value: number, goal: number, stepSize: number) {
  return value < goal ? Math.min(goal, value + stepSize) : Math.max(goal, value - stepSize);
}

function ease(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}
