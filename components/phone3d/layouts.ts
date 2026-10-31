/**
 * Where the 3D phone stands, in the units of the drawing it replaces. No three.js here: the React side
 * reads these to place the canvas, the engine reads them to place the phone, and the two can't drift.
 *
 * The canvas is a transparent overlay on top of the existing drawing (the 260×220 RedPhone on the home
 * page, the 1000×820 CallStage in a call). It never takes a pointer: the drawn phone's static hit outline
 * and the real <button> stay exactly where they were.
 */
export interface PhoneLayout {
  /** The drawing the overlay sits on, in its own viewBox units. */
  host: { w: number; h: number };
  /** The canvas in host units. It may reach past the host box so the shadow and a lifted handset fit. */
  overlay: { x: number; y: number; w: number; h: number };
  /** The phone's base centre on the table, and how wide its footprint should look. */
  base: { x: number; y: number; width: number };
  /**
   * Where the handset goes when the line is open: its centre, and the screen angle of the mouthpiece end
   * (degrees, clockwise like SVG's rotate). Without it, "lifted" only raises the handset over the cradle.
   */
  cheek?: { x: number; y: number; angle: number };
  /** Turned on the table (radians, + shows the lit left wall) and tipped toward the viewer. */
  yaw: number;
  pitch: number;
}

/*
 * Both views share one camera language, chosen against the real screenshots: seen from only a little
 * above (pitch ≈ 17°), so the dial faces you and the handset sits on the phone instead of reading as a
 * handle on a box; turned a quarter toward the lamp (yaw ≈ 17°), so the lit left wall gives it depth
 * and the right side falls into the same shade as the plush's right side.
 */
const YAW = 0.34;
const PITCH = 0.42;

/**
 * The home page: the phone on the table in front of 面包's right foot, inside the phone button's
 * drawing (RedPhone's 260×220). Its front edge lands where the drawn plinth's did, so the drawn floor
 * shadow and the button's hit outline stay under it.
 */
export const HERO_PHONE: PhoneLayout = {
  host: { w: 260, h: 220 },
  overlay: { x: -24, y: 0, w: 316, h: 242 },
  base: { x: 132, y: 171, width: 228 },
  yaw: YAW,
  pitch: PITCH,
};

/**
 * The call: the same place the drawn phone has in CallStage's 1000×820 picture (an svg at 600,490 scaled
 * by 380/260). Lifted, the handset is held against 面包's right cheek: centred just off its face, the
 * earpiece up by the eye, the mouthpiece angled down toward the smile, a little in front of the photo.
 */
export const CALL_PHONE: PhoneLayout = {
  host: { w: 1000, h: 820 },
  overlay: { x: 0, y: 0, w: 1000, h: 820 },
  base: { x: 726, y: 722, width: 338 },
  cheek: { x: 610, y: 386, angle: 108 },
  yaw: 0.3,
  pitch: 0.26,
};

/** The canvas box as CSS percentages of the host box. */
export function overlayBox(layout: PhoneLayout) {
  const { host, overlay } = layout;
  return {
    left: `${(overlay.x / host.w) * 100}%`,
    top: `${(overlay.y / host.h) * 100}%`,
    width: `${(overlay.w / host.w) * 100}%`,
    height: `${(overlay.h / host.h) * 100}%`,
  };
}
