/**
 * Utility to build PMKS+ mechanism URL strings programmatically.
 */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';
const N = CHARS.length; // 64

function toBaseN(integer: number): string {
  integer = Math.floor(integer);
  const positive = integer >= 0;
  integer = Math.abs(integer);
  let s = '';
  do {
    s = CHARS.charAt(integer % N) + s;
    integer = Math.floor(integer / N);
  } while (integer > 0);
  if (!positive) s = '0' + s;
  return s;
}

function encCoord(v: number): string {
  return toBaseN(Math.round(v * 1000));
}

function encDecimal(v: number): string {
  return toBaseN(Math.round(v * 1000));
}

interface JointDef {
  id: string;
  x: number;
  y: number;
  input?: boolean;
  ground?: boolean;
  prismatic?: boolean;
  angle?: number;
}

interface LinkDef {
  id: string;
  joints: string[];
  color?: string;
}

export function buildMechanismUrl(joints: JointDef[], links: LinkDef[]): string {
  // Use the exact same settings header as all existing templates (verified to work)
  const settingsHeader = '0P.TY.K,0.101';

  // Joints
  const jointStrs: string[] = [];
  for (const j of joints) {
    // Flag bits: isPrismatic, isInput, isGrounded, isWelded, showCurve
    let flags = 0;
    if (j.prismatic) flags |= (1 << 0);
    if (j.input) flags |= (1 << 1);
    if (j.ground) flags |= (1 << 2);
    // isWelded = false (bit 3)
    flags |= (1 << 4); // showCurve = true
    const flagChar = CHARS[flags];

    const x = encCoord(j.x);
    const y = encCoord(j.y);
    const angle = encCoord(j.angle ?? 0);
    jointStrs.push(`${flagChar}${j.id},${j.id},${x},${y},${angle}`);
  }

  // Section 6: Links
  const linkStrs: string[] = [];
  const colors = ['c5cae9', '303e9f', '0d125a', 'B2DFDB', '26A69A', '5C6BC0', '7986CB', '4DB6AC'];
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const color = l.color || colors[i % colors.length];
    const jointIds = l.joints.join(',');
    // Compute center of mass from joint positions
    const ljts = l.joints.map(jid => joints.find(j => j.id === jid)!);
    const cx = ljts.reduce((s, j) => s + j.x, 0) / ljts.length;
    const cy = ljts.reduce((s, j) => s + j.y, 0) / ljts.length;
    const mass = encDecimal(1);
    const moI = encDecimal(1);
    const xCoM = encCoord(cx);
    const yCoM = encCoord(cy);
    linkStrs.push(`YR${l.id},${l.id},${mass},${moI},${xCoM},${yCoM},${color},${jointIds},,`);
  }

  // Section 7: Forces (empty)
  // Section 8: Active object + checksum
  const activeObj = 'J' + joints[0].id; // Select first joint

  // Assemble (without checksum)
  const withoutChecksum =
    settingsHeader + '.' +
    jointStrs.join('.') + '..' +
    linkStrs.join('.') + '...' +
    activeObj;

  // Checksum
  const checksumChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const checksum = checksumChars[(withoutChecksum.length + 1) % 62];

  return withoutChecksum + checksum;
}
