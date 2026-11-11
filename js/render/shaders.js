// 每张幻灯片是一个四边形。圆角、描边、投影都由片元着色器里的 SDF 计算，
// 因此在任意分辨率、任意 3D 角度下边缘都保持锐利。

export const VERT = `#version 300 es
in vec2 aPos;            // 单位四边形 [-0.5, 0.5]
uniform mat4 uMVP;
uniform vec2 uSize;      // 幻灯片宽高（世界单位）
uniform float uPad;      // 四边形外扩，用于抗锯齿和投影
uniform vec2 uOffset;    // 投影偏移（幻灯片局部平面内）
uniform mat4 uTile;      // 分块 / 局部渲染的裁切矩阵（uMVP 是整个画板的投影）
uniform int uDepthMode;  // 远近效果：0 关，1 正交相机，2 透视相机（从裁剪坐标还原视图空间的 z）
uniform float uDofPad;   // 景深模糊时边缘会柔化出去：四边形再外扩（占卡片长边的比例）
out vec2 vLocal;
out vec3 vClip;          // 画板的裁剪坐标（xy、w），用于按画板位置计算渐隐遮罩
out float vViewZ;        // 视图空间的 z（越大离镜头越近）
void main() {
  vec2 local = aPos * (uSize + 2.0 * (uPad + uDofPad * max(uSize.x, uSize.y)));
  vLocal = local;
  vec4 clip = uMVP * vec4(local + uOffset, 0.0, 1.0);
  vClip = clip.xyw;
  // 正交：ortho(near = -1e5, far = 1e5) 下 z_clip = -z / 1e5；透视：w = -z
  vViewZ = uDepthMode == 2 ? -clip.w : -clip.z * 1e5;
  gl_Position = uTile * clip;
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vClip;
uniform vec2 uSize;
uniform float uRadius;
uniform int uMode;           // 0 = 幻灯片, 1 = 投影, 2 = 高亮叠加, 3 = 擦除（配合 blendFunc(ZERO, 1 - srcAlpha)）
uniform vec3 uHLColor;
uniform float uHLFill;       // 高亮填充不透明度
uniform float uHLRing;       // 高亮描边宽度（像素）
uniform sampler2D uTex;
uniform vec4 uUV;            // xy = 缩放, zw = 偏移（cover 裁切）
uniform float uBorder;
uniform vec3 uBorderColor;
uniform float uBlur;
uniform vec4 uShadowColor;
uniform float uOpacity;
uniform int uFade;           // 渐隐遮罩：0 无，1 线性，2 两端，3 径向，4 单色（整体同一不透明度）
uniform vec2 uFadeDir;       // 线性方向（画板坐标，y 向下）
uniform float uFadeAspect;   // 画板宽高比
uniform vec4 uFadeParams;    // 开始位置、结束位置、起点不透明度、终点不透明度
uniform highp int uDepthMode; // 和顶点着色器里的同一个 uniform：精度要一致
uniform vec3 uDepthFx;       // 远处渐隐强度、景深模糊强度、对焦位置（0 = 最远，1 = 最近）
uniform vec2 uDepthRange;    // 画板里卡片的视图 z 范围：最远、最近
uniform float uFixedZ;       // 抬起的卡片：整张用同一个视图 z（它下面那块桌面的）；< -1e29 时逐像素
in float vViewZ;
out vec4 outColor;

const float DOF_MAX = 0.035; // 景深最大模糊半径（占卡片宽度）

// 远近：0 = 画板里最远的卡片，1 = 最近的（超出范围的继续往外延伸）
float depthT() { return ((uFixedZ > -1e29 ? uFixedZ : vViewZ) - uDepthRange.x) / max(uDepthRange.y - uDepthRange.x, 1e-3); }
float farFade(float t) { return 1.0 - uDepthFx.x * (1.0 - smoothstep(0.0, 0.75, t)); }
float dofFrac(float t) { return uDepthFx.y * DOF_MAX * smoothstep(0.08, 0.55, abs(clamp(t, 0.0, 1.0) - uDepthFx.z)); }

// 按像素在画板上的位置计算遮罩不透明度（与分块、视图缩放无关，所见即所得）
float fadeAlpha() {
  if (uFade == 0) return 1.0;
  if (uFade == 4) return uFadeParams.z;
  vec2 ndc = vClip.xy / vClip.z;
  vec2 q = vec2(ndc.x * 0.5 * uFadeAspect, -ndc.y * 0.5); // 以画板中心为原点，画板高度为 1
  float t;
  if (uFade == 3) {
    t = length(vec2(q.x / (0.5 * uFadeAspect), q.y / 0.5));
  } else {
    float len = abs(uFadeAspect * uFadeDir.x) + abs(uFadeDir.y); // 与 CSS 渐变线长度一致
    t = dot(q, uFadeDir) / len + 0.5;
    if (uFade == 2) t = abs(t - 0.5) * 2.0;
  }
  float k = smoothstep(uFadeParams.x, max(uFadeParams.y, uFadeParams.x + 1e-4), t);
  return mix(uFadeParams.z, uFadeParams.w, k);
}

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 hs = uSize * 0.5;
  float r = min(uRadius, min(hs.x, hs.y));
  float d = sdRoundRect(vLocal, hs, r);

  float t = uDepthMode != 0 ? depthT() : 1.0;
  float depthA = uDepthMode != 0 ? farFade(t) : 1.0;
  float blurW = uDepthMode != 0 ? dofFrac(t) * uSize.x : 0.0; // 景深模糊半径（世界单位）

  if (uMode == 1) {
    float b = max(uBlur, 0.5) + blurW;
    float a = 1.0 - smoothstep(-b, b, d);
    outColor = vec4(uShadowColor.rgb, 1.0) * (uShadowColor.a * a * uOpacity * fadeAlpha() * depthA);
    return;
  }

  float aa = max(fwidth(d), 1e-4);
  float edgeW = max(0.5 * aa, blurW);
  float cover = 1.0 - smoothstep(-edgeW, edgeW, d);

  if (uMode == 3) {
    // 擦除：清掉卡片下面已经画了的东西（远处渐隐时卡片半透明，不能透出后面的卡片）
    outColor = vec4(cover);
    return;
  }

  if (uMode == 2) {
    // 描边画在边缘内侧，宽度按屏幕像素计算，任何缩放/透视下粗细一致
    float ring = 0.0;
    if (uHLRing > 0.0) {
      float halfW = uHLRing * 0.5 * aa;
      ring = 1.0 - smoothstep(halfW - 0.5 * aa, halfW + 0.5 * aa, abs(d + halfW));
    }
    float a = max(ring, cover * uHLFill);
    outColor = vec4(uHLColor, 1.0) * (a * uOpacity);
    return;
  }

  vec2 uv = vLocal / uSize + 0.5;
  uv.y = 1.0 - uv.y;
  uv = uv * uUV.xy + uUV.zw;
  // 导数和普通采样都要在分支外面做（同一组像素有的走模糊分支、有的不走，分支里的隐式导数不可靠）
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  vec4 c = texture(uTex, uv);   // 预乘 alpha
  if (blurW > 0.0) {
    // 景深：把两个方向的采样梯度各自放大到至少等于模糊半径，再在一圈上取 8 个点平均；半径按卡片宽度的比例算，和导出分辨率无关。
    // 显式梯度的采样在有些显卡上没有各向异性过滤，刚开始模糊的地方会比普通采样「糊一档」——从普通采样渐变过去，不出现分界线
    vec2 ts = vec2(textureSize(uTex, 0));
    vec2 r = vec2(blurW / uSize.x, blurW / uSize.y) * uUV.xy; // 半径（uv）
    float want = r.x * ts.x * 0.5; // 至少覆盖几个纹素
    gx *= max(1.0, want / (length(gx * ts) + 1e-6));
    gy *= max(1.0, want / (length(gy * ts) + 1e-6));
    vec2 lo = uUV.zw, hi = uUV.zw + uUV.xy;
    vec4 b = textureGrad(uTex, uv, gx, gy) * 2.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      b += textureGrad(uTex, clamp(uv + vec2(cos(a), sin(a)) * r * 0.6, lo, hi), gx, gy);
    }
    c = mix(c, b / 10.0, smoothstep(0.0, 0.35, blurW / (DOF_MAX * uSize.x)));
  }

  if (uBorder > 0.0) {
    float edge = smoothstep(-uBorder - 0.5 * aa, -uBorder + 0.5 * aa, d);
    c = mix(c, vec4(uBorderColor, 1.0), edge);
  }
  if (!gl_FrontFacing) c.rgb *= 0.45;   // 背面（如环形展台后侧）压暗
  outColor = c * (cover * uOpacity * fadeAlpha() * depthA);
}`;
