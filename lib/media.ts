/**
 * 图片与评论的纯逻辑：常量、魔数嗅探、id/正文校验、错误码。
 * 不依赖 cloudflare:workers，可在 Node 里直接回归测试。
 */

export const MAX_ENTRY_IMAGES = 9;
export const MAX_COMMENT_IMAGES = 3;
export const MAX_COMMENT_LENGTH = 300;
export const MAX_IMAGE_DIMENSION = 10000;
export const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof MIME_TYPES)[number];
export type MediaStorage = 'r2' | 'd1';
export type MediaVariant = 'full' | 'thumb';
export type MediaMeta = { id: string; width: number; height: number; bytes: number; thumbBytes: number };
export type MediaLimits = {
  mode: MediaStorage;
  maxBytes: number;
  maxThumbBytes: number;
  maxPerEntry: number;
  maxPerComment: number;
};
export type CommentRecord = {
  id: string;
  entryId: string;
  /** 顶级评论为 null；回复统一挂在根评论上（最多两级）。 */
  parentId: string | null;
  /** 回复的是谁，用来显示「回复 @某某」。 */
  replyToOwner: string | null;
  body: string;
  createdBy: string;
  createdAt: string;
  images: MediaMeta[];
  likeCount: number;
  likedByMe: boolean;
};

export const IMAGE_LIMITS: Record<MediaStorage, { maxBytes: number; maxThumbBytes: number }> = {
  r2: { maxBytes: 2000000, maxThumbBytes: 300000 },
  d1: { maxBytes: 700000, maxThumbBytes: 120000 },
};

const STATUS_BY_CODE = {
  IMAGE_LIMIT: 400,
  IMAGE_INVALID: 400,
  IMAGE_TOO_LARGE: 413,
  IMAGE_UNSUPPORTED: 415,
  IMAGE_CONFLICT: 409,
  TARGET_NOT_FOUND: 404,
  ENTRY_NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  ENTRY_CONFLICT: 409,
  COMMENT_INVALID: 400,
  MEDIA_UNAVAILABLE: 503,
  SERVER_ERROR: 500,
} as const;
export type MediaErrorCode = keyof typeof STATUS_BY_CODE;

export class MediaError extends Error {
  code: MediaErrorCode;
  status: number;
  constructor(code: MediaErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MediaError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export function mediaErrorStatus(code: MediaErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function mediaError(code: MediaErrorCode, message?: string): MediaError {
  return new MediaError(code, message);
}

/** 只认文件头，不信任扩展名 / Content-Type。 */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

export function isThumbJpeg(bytes: Uint8Array): boolean {
  return sniffImageMime(bytes) === 'image/jpeg';
}

/** 客户端生成的 UUID 或 32 位 hex；限制字符集与长度，避免拼进对象 key 后越界。 */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function normalizeCommentBody(value: unknown): string {
  if (typeof value !== 'string') throw mediaError('COMMENT_INVALID', '评论内容无效');
  const body = value.trim();
  const length = [...body].length;
  if (length < 1) throw mediaError('COMMENT_INVALID', '评论不能为空');
  if (length > MAX_COMMENT_LENGTH) throw mediaError('COMMENT_INVALID', `评论不能超过 ${MAX_COMMENT_LENGTH} 字`);
  return body;
}

export function mediaObjectKey(id: string, variant: MediaVariant): string {
  return `media/${id}/${variant === 'thumb' ? 'thumb' : 'original'}`;
}
