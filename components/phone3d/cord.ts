import { BufferAttribute, BufferGeometry, Mesh, Vector3, type Material } from 'three';

/** Same count of turns in every pose, like the drawn cord: stretching opens the coil, it never adds loops. */
const TURNS = 22;
const PER_TURN = 12;
const SIDES = 6;
const N = TURNS * PER_TURN + 1;

/**
 * The coiled cord, rebuilt in place whenever its ends move: a helix wound round a sagging cubic spine,
 * swept as a thin tube. One fixed-size buffer, written over each time, so following the handset across
 * the screen costs no allocation at all.
 */
export class CoilCord {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly position = new Float32Array(N * SIDES * 3);
  private readonly normal = new Float32Array(N * SIDES * 3);
  private readonly path = Array.from({ length: N }, () => new Vector3());
  private readonly s = new Vector3();
  private readonly t = new Vector3();
  private readonly n1 = new Vector3();
  private readonly n2 = new Vector3();
  private readonly d = new Vector3();

  constructor(material: Material) {
    const index = new Uint16Array((N - 1) * SIDES * 6);
    let k = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let s = 0; s < SIDES; s++) {
        const a = i * SIDES + s;
        const b = i * SIDES + ((s + 1) % SIDES);
        index[k++] = a;
        index[k++] = b;
        index[k++] = b + SIDES;
        index[k++] = a;
        index[k++] = b + SIDES;
        index[k++] = a + SIDES;
      }
    }
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(this.normal, 3));
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = 'cord_live';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** a → b along a cubic with handles c1, c2; all in the parent's space. */
  update(a: Vector3, c1: Vector3, c2: Vector3, b: Vector3, coilRadius: number, tubeRadius: number) {
    const { path, s, t, n1, n2 } = this;

    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      cubic(a, c1, c2, b, u, s);
      cubicTangent(a, c1, c2, b, u, t);
      if (t.lengthSq() < 1e-12) t.set(1, 0, 0);
      t.normalize();
      carry(t, n1, i === 0);
      n2.crossVectors(t, n1);
      // the coil eases to nothing at both plugs, as a real cord's moulded ends do
      const k = Math.min(1, u * 10, (1 - u) * 10);
      const phi = Math.PI * 2 * TURNS * u;
      path[i]
        .copy(s)
        .addScaledVector(n1, Math.cos(phi) * coilRadius * k)
        .addScaledVector(n2, Math.sin(phi) * coilRadius * k);
    }

    const { position, normal, d } = this;
    for (let i = 0; i < N; i++) {
      t.subVectors(path[Math.min(N - 1, i + 1)], path[Math.max(0, i - 1)]);
      if (t.lengthSq() < 1e-14) t.set(1, 0, 0);
      t.normalize();
      carry(t, n1, i === 0);
      n2.crossVectors(t, n1);
      for (let side = 0; side < SIDES; side++) {
        const theta = (Math.PI * 2 * side) / SIDES;
        d.copy(n1).multiplyScalar(Math.cos(theta)).addScaledVector(n2, Math.sin(theta));
        const o = (i * SIDES + side) * 3;
        position[o] = path[i].x + d.x * tubeRadius;
        position[o + 1] = path[i].y + d.y * tubeRadius;
        position[o + 2] = path[i].z + d.z * tubeRadius;
        normal[o] = d.x;
        normal[o + 1] = d.y;
        normal[o + 2] = d.z;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
  }
}

/** Keep `n` perpendicular to `t`, carried along rather than recomputed, so the section never spins. */
function carry(t: Vector3, n: Vector3, fresh: boolean) {
  if (!fresh) {
    n.addScaledVector(t, -n.dot(t));
    if (n.lengthSq() > 1e-12) {
      n.normalize();
      return;
    }
  }
  n.set(0, 1, 0);
  if (Math.abs(t.y) > 0.9) n.set(1, 0, 0);
  n.addScaledVector(t, -n.dot(t)).normalize();
}

function cubic(a: Vector3, b: Vector3, c: Vector3, d: Vector3, u: number, out: Vector3) {
  const v = 1 - u;
  return out
    .copy(a)
    .multiplyScalar(v * v * v)
    .addScaledVector(b, 3 * v * v * u)
    .addScaledVector(c, 3 * v * u * u)
    .addScaledVector(d, u * u * u);
}

function cubicTangent(a: Vector3, b: Vector3, c: Vector3, d: Vector3, u: number, out: Vector3) {
  const v = 1 - u;
  return out
    .copy(b)
    .sub(a)
    .multiplyScalar(3 * v * v)
    .addScaledVector(c, 6 * v * u)
    .addScaledVector(b, -6 * v * u)
    .addScaledVector(d, 3 * u * u)
    .addScaledVector(c, -3 * u * u);
}
