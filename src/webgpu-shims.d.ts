// Shim for VideoFrame type used by @webgpu/types but not available in all TS configs
interface VideoFrame {
  readonly codedWidth: number;
  readonly codedHeight: number;
  close(): void;
}
