import { z } from 'zod';
import { config } from '../server/config.js';
import { isAllowedEmbedUrl } from '../shared/embedHosts.js';

const L = config.limits;

/**
 * Thông báo mặc định của zod bằng tiếng Việt (các schema bên dưới có message riêng
 * thì message riêng được ưu tiên; map này chỉ lấp chỗ còn lại, vd "Required").
 */
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === 'undefined' ? 'Trường này là bắt buộc.' : 'Kiểu dữ liệu không hợp lệ.' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: `Cần ít nhất ${issue.minimum} ký tự.` };
      if (issue.type === 'array') return { message: `Cần ít nhất ${issue.minimum} phần tử.` };
      return { message: `Giá trị phải từ ${issue.minimum} trở lên.` };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Tối đa ${issue.maximum} ký tự.` };
      if (issue.type === 'array') return { message: `Tối đa ${issue.maximum} phần tử.` };
      return { message: `Giá trị phải từ ${issue.maximum} trở xuống.` };
    case z.ZodIssueCode.invalid_string:
      return { message: 'Định dạng không hợp lệ.' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Giá trị không nằm trong danh sách cho phép.' };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'Có trường không được hỗ trợ.' };
    default:
      return { message: ctx.defaultError };
  }
});

/** Ky tu cho phep trong username: chu, so, dau gach duoi, gach ngang, cham. */
export const usernameSchema = z
  .string()
  .trim()
  .min(L.usernameMin, `Tên đăng nhập phải có ít nhất ${L.usernameMin} ký tự.`)
  .max(L.usernameMax, `Tên đăng nhập tối đa ${L.usernameMax} ký tự.`)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Tên đăng nhập chỉ gồm chữ cái, số, . _ -');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email không hợp lệ.')
  .max(L.emailMax, 'Email quá dài.');

export const passwordSchema = z
  .string()
  .min(L.passwordMin, `Mật khẩu phải có ít nhất ${L.passwordMin} ký tự.`)
  .max(L.passwordMax, 'Mật khẩu quá dài.');

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Xác nhận mật khẩu không khớp.',
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại.'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Mật khẩu mới phải khác mật khẩu cũ.',
  });

export const updateProfileSchema = z.object({
  username: usernameSchema.optional(),
  email: emailSchema.optional(),
});

// ---------------------------------------------------------------- diagram ---

/** So thuc hop le (x/y/width/height/rotation...). */
const num = z.number().finite();

/** Màu an toàn: hex 3–8 ký tự, rgb()/rgba()/hsl()/hsla() hoặc tên màu CSS (none, transparent, red...). */
const colorRegex = /^(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?\(\s*[0-9.%\s,/-]{1,48}\)|[a-zA-Z]{3,32})$/;
const color = z.string().trim().max(64).regex(colorRegex, 'Màu không hợp lệ.');

const styleSchema = z
  .object({
    fill: color.optional(),
    stroke: color.optional(),
    strokeWidth: num.min(0).max(64).optional(),
    strokeDasharray: z.string().trim().max(64).regex(/^[0-9,\s]*$/).optional(),
    opacity: num.min(0).max(1).optional(),
    radius: num.min(0).max(512).optional(),
    fontSize: num.min(6).max(200).optional(),
    fontWeight: z.enum(['normal', 'bold']).optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    textDecoration: z.enum(['none', 'underline']).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
    textColor: color.optional(),
    background: color.optional(),
    lineType: z.enum(['solid', 'dashed', 'dotted']).optional(),
    route: z.enum(['straight', 'elbow', 'curve']).optional(),
    shadow: z.boolean().optional(),
    arrowStart: z.enum(['none', 'arrow', 'triangle']).optional(),
    arrowEnd: z.enum(['none', 'arrow', 'triangle']).optional(),
    z: num.int().min(-1000000).max(1000000).optional(),
  })
  .strip();

/** Text trong element: escape boi client khi render; server gioi han do dai. */
const textContent = z.string().max(4000);

export const elementTypeSchema = z.enum([
  'rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'line', 'arrow',
  'connector', 'text', 'note', 'frame', 'image', 'group',
  // hình khối bổ sung
  'triangle', 'right-triangle', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
  'star', 'plus', 'cylinder', 'document', 'cloud', 'callout', 'arrow-right', 'chevron', 'heart',
  // phương tiện
  'video', 'embed',
]);

/** Nguồn ảnh: https hoặc data URI ảnh (tải lên). Nguồn video: chỉ https. */
const imageSrcRegex = /^(https:\/\/[^\s"'<>]{4,2000}|data:image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/=]+)$/;
const videoSrcRegex = /^https:\/\/[^\s"'<>]{4,2000}$/;

const elementSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: elementTypeSchema,
    x: num,
    y: num,
    width: num.min(0).max(100000).optional(),
    height: num.min(0).max(100000).optional(),
    points: z.array(z.tuple([num, num])).max(200).optional(),
    rotation: num.min(-3600).max(3600).optional(),
    text: textContent.optional(),
    style: styleSchema.optional(),
    // connector: id shape dau/cuoi
    startId: z.string().min(1).max(64).optional(),
    endId: z.string().min(1).max(64).optional(),
    startSide: z.enum(['top', 'bottom', 'left', 'right']).optional(),
    endSide: z.enum(['top', 'bottom', 'left', 'right']).optional(),
    // group
    children: z.array(z.string().min(1).max(64)).max(2000).optional(),
    // phương tiện: ảnh/GIF (src), video (src), nhúng (embedUrl + provider)
    src: z.string().max(L.mediaItemChars).optional(),
    embedUrl: z.string().max(2000).optional(),
    provider: z.string().trim().max(40).optional(),
    title: z.string().trim().max(200).optional(),
    alt: z.string().trim().max(300).optional(),
    lockRatio: z.boolean().optional(),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    controls: z.boolean().optional(),
  })
  .strip()
  .superRefine((el, ctx) => {
    const bad = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (el.type === 'image') {
      if (!el.src || !imageSrcRegex.test(el.src)) bad('src', 'Ảnh phải là liên kết https hoặc ảnh tải lên hợp lệ.');
    } else if (el.type === 'video') {
      if (!el.src || !videoSrcRegex.test(el.src)) bad('src', 'Video phải là liên kết https.');
    } else if (el.type === 'embed') {
      if (!el.embedUrl || !isAllowedEmbedUrl(el.embedUrl)) bad('embedUrl', 'Liên kết nhúng không hợp lệ hoặc trang này chưa được hỗ trợ.');
    }
  });

const viewportSchema = z
  .object({ x: num, y: num, zoom: num.min(0.05).max(20) })
  .strip();

export const diagramDataSchema = z
  .object({
    version: z.literal(1),
    viewport: viewportSchema,
    elements: z.array(elementSchema).max(L.maxElements),
  })
  .strip()
  .superRefine((d, ctx) => {
    const total = d.elements.reduce((n, e) => n + (e.src ? e.src.length : 0), 0);
    if (total > L.mediaTotalChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['elements'],
        message: `Ảnh/GIF trong sơ đồ quá nặng (tối đa ${Math.floor(L.mediaTotalChars / 1048576)}MB). Hãy dùng liên kết thay vì tải lên.`,
      });
    }
  });

export const createDiagramSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên sơ đồ.').max(L.diagramNameLength, `Tên tối đa ${L.diagramNameLength} ký tự.`),
  data: diagramDataSchema,
});

export const updateDiagramSchema = z.object({
  name: z.string().trim().min(1).max(L.diagramNameLength).optional(),
  data: diagramDataSchema.optional(),
  viewport: viewportSchema.optional(),
});

// ------------------------------------------------------------------ share ---
export const shareTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,100}$/, 'Liên kết chia sẻ không hợp lệ.');

// ---------------------------------------------------------------- settings ---
export const updateSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  editor: z
    .object({
      gridVisible: z.boolean().optional(),
      snapEnabled: z.boolean().optional(),
      confirmBeforeDelete: z.boolean().optional(),
      zoomStep: num.min(1.05).max(3).optional(),
    })
    .optional(),
});

// ------------------------------------------------------------------ admin ---
export const adminUpdateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'locked']).optional(),
});

/** Chuyen ZodError thanh { field: message } cho client. */
export function zodFieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
