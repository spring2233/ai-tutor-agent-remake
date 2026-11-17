export const planetVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const planetFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorAccent;
  uniform vec3 uColorDark;
  uniform vec3 uRimColor;
  uniform vec3 uCoronaColor;
  uniform float uHover;
  uniform float uBurst;
  uniform float uProgress;
  uniform float uStage;
  uniform vec3 uLightDir;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i);
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise3(p);
      p = p * 2.03 + 13.17;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);
    vec3 light = normalize(uLightDir);
    vec3 unitLocal = normalize(vLocalPos);

    // 4 档阶段平滑权重: 0=未探索, 1=探索中, 2=部分完成, 3=全部完成
    float w0 = 1.0 - smoothstep(0.0, 0.9, uStage);
    float w1 = smoothstep(0.0, 0.85, uStage) * (1.0 - smoothstep(1.15, 1.95, uStage));
    float w2 = smoothstep(1.1, 1.95, uStage) * (1.0 - smoothstep(2.1, 2.95, uStage));
    float w3 = smoothstep(2.05, 2.95, uStage);

    float bands = sin(vLocalPos.y * (4.2 + uSeed * 5.0) + fbm(vLocalPos * 1.8 + uTime * 0.07) * 3.5);
    float continentField = fbm(vLocalPos * (2.35 + uSeed * 1.1) + vec3(uSeed * 8.0));
    float continents = smoothstep(0.41, 0.61, continentField);
    float flow = fbm(vLocalPos * 3.1 + vec3(uTime * 0.045, uSeed, -uTime * 0.03));

    vec3 surface = mix(uColorB, uColorA, continents * 0.72 + flow * 0.28);
    surface = mix(surface, uColorA * 1.08, smoothstep(0.15, 0.85, bands) * 0.38);

    float ndl = dot(n, light);
    float terminator = smoothstep(-0.15, 0.30, ndl);
    vec3 lit = mix(uColorDark * 1.25, surface, terminator);
    lit += uColorA * pow(max(ndl, 0.0), 6.0) * 0.16 * (1.0 - w0 * 0.85);

    // Stage 0 (未探索): 低亮度、暗淡休眠，菲涅尔微弱 (0.2)
    vec3 stage0Col = mix(uColorDark * 0.9, lit * 0.36, 0.68);

    // Stage 1 (探索中): 星核裂隙呼吸发光
    float breath = 0.5 + 0.5 * sin(uTime * 2.6 + uSeed * 6.28318);
    float ridge = 1.0 - abs(fbm(vLocalPos * 3.6 + vec3(uSeed * 4.2, uTime * 0.05, 0.0)) - 0.5) * 2.0;
    float coreVeins = pow(clamp(ridge, 0.0, 1.0), 4.2);
    vec3 coreGlow = mix(uColorA, uColorAccent, 0.45 + breath * 0.45) * coreVeins * (0.28 + breath * 0.52);
    vec3 stage1Col = lit * (0.74 + breath * 0.14) + coreGlow;

    // Stage 2 & 3 (部分完成 / 全部完成): 局部或全域发光大陆网格 + 微光花海
    vec3 sweepAxis = normalize(vec3(sin(uSeed * 6.28) * 0.45, 0.32, cos(uSeed * 6.28) * 0.85));
    float regionCoord = dot(unitLocal, sweepAxis) * 0.5 + 0.5;
    float threshold = clamp(1.04 - uProgress * 1.15, 0.0, 0.82);
    float awakeMask = mix(smoothstep(threshold - 0.14, threshold + 0.16, regionCoord), 1.0, w3);

    // 测地发光大陆网格
    float gx = smoothstep(0.955, 0.995, abs(sin(vLocalPos.x * 16.0 + flow * 1.4)));
    float gy = smoothstep(0.955, 0.995, abs(sin(vLocalPos.y * 16.0 - flow * 1.2)));
    float gz = smoothstep(0.955, 0.995, abs(sin(vLocalPos.z * 16.0 + flow * 1.1)));
    float continentGrid = clamp(gx + gy + gz, 0.0, 1.0) * continents * awakeMask;

    // 地表微光花海群落（呼应暗夜花谷）
    float bloomNoise = fbm(vLocalPos * 8.8 + vec3(uSeed * 13.0, uTime * 0.04, -uSeed * 5.0));
    float twinkle = 0.65 + 0.35 * sin(uTime * 2.1 + bloomNoise * 14.0);
    float flowerSea = smoothstep(0.58, 0.82, bloomNoise) * continents * awakeMask * twinkle;

    vec3 creamGold = vec3(0.97, 0.93, 0.84);
    vec3 gridCol = mix(uColorA, uColorAccent, 0.5) * continentGrid * 0.52;
    vec3 flowerCol = mix(uColorAccent, creamGold, 0.58) * flowerSea * 0.62;

    vec3 stage2Col = lit * mix(0.58, 0.96, awakeMask) + gridCol + flowerCol;
    vec3 stage3Col = lit * 1.04 + gridCol * 0.68 + flowerCol * 0.88 + uCoronaColor * continents * 0.14;

    vec3 bodyCol = stage0Col * w0 + stage1Col * w1 + stage2Col * w2 + stage3Col * w3;

    // 4 档菲涅尔光晕：未探索严格 0.20，探索中呼吸，部分完成通透，100% 奶油金日冕
    float fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 3.0);
    float fresnelStrength =
      0.20 * w0 +
      (0.42 + breath * 0.24) * w1 +
      0.48 * w2 +
      (0.76 + 0.14 * sin(uTime * 1.9)) * w3 +
      uHover * 0.28 +
      uBurst * 0.65;
    vec3 rimTint = mix(uRimColor, mix(creamGold, uCoronaColor, 0.5), w3 * 0.78);
    vec3 atmosphere = rimTint * fresnel * fresnelStrength;

    vec3 col = bodyCol + atmosphere;
    col += rimTint * uBurst * 0.18;
    col = min(col, vec3(1.22));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export const atmosphereVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const atmosphereFragmentShader = /* glsl */ `
  uniform vec3 uRimColor;
  uniform vec3 uCoronaColor;
  uniform float uHover;
  uniform float uBurst;
  uniform float uStage;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);
    float fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 2.8);

    float w0 = 1.0 - smoothstep(0.0, 0.9, uStage);
    float w1 = smoothstep(0.0, 0.85, uStage) * (1.0 - smoothstep(1.15, 1.95, uStage));
    float w2 = smoothstep(1.1, 1.95, uStage) * (1.0 - smoothstep(2.1, 2.95, uStage));
    float w3 = smoothstep(2.05, 2.95, uStage);

    float breath = 0.5 + 0.5 * sin(uTime * 2.5);
    float baseAlpha =
      0.06 * w0 +
      (0.18 + breath * 0.10) * w1 +
      0.24 * w2 +
      (0.46 + 0.08 * sin(uTime * 1.8)) * w3;

    vec3 col = mix(uRimColor, mix(vec3(0.97, 0.93, 0.84), uCoronaColor, 0.55), w3 * 0.82);
    float alpha = fresnel * (baseAlpha + uHover * 0.14 + uBurst * 0.26);
    gl_FragColor = vec4(col, alpha);
  }
`;

export const progressRingVertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const progressRingFragmentShader = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uCyan;
  uniform vec3 uGold;
  varying vec3 vLocal;

  void main() {
    if (uOpacity < 0.01) discard;
    float ang = fract(atan(vLocal.y, vLocal.x) / 6.2831853 + 0.5);
    float fill = clamp(uProgress, 0.12, 1.0);

    // 底轨微弱刻度
    float ticks = smoothstep(0.35, 0.85, sin(ang * 180.0));
    float trackAlpha = (0.10 + ticks * 0.08) * uOpacity;
    vec3 trackCol = mix(uCyan, vec3(0.96, 0.94, 0.89), 0.35);

    // 动态青金色填充弧与流光前锋
    float inArc = 1.0 - smoothstep(fill - 0.008, fill + 0.008, ang);
    float pulse = 0.72 + 0.28 * sin(ang * 24.0 - uTime * 3.4);
    float head = exp(-pow((ang - fill) * 42.0, 2.0)) * step(0.01, fill);
    vec3 arcCol = mix(uCyan, uGold, clamp(ang / max(fill, 0.01), 0.0, 1.0));
    arcCol = arcCol * (0.85 + pulse * 0.35) + vec3(1.0, 0.96, 0.86) * head * 0.95;

    vec3 finalCol = mix(trackCol, arcCol, inArc);
    float finalAlpha = mix(trackAlpha, (0.78 + head * 0.22) * uOpacity, inArc);
    gl_FragColor = vec4(finalCol, finalAlpha);
  }
`;

export const coronaVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const coronaFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uAmount;
  uniform float uSeed;
  uniform vec3 uCoronaColor;
  varying vec2 vUv;

  void main() {
    if (uAmount < 0.01) discard;
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0 || r < 0.34) discard;

    float ang = atan(p.y, p.x);
    float raysA = 0.5 + 0.5 * sin(ang * 12.0 + uTime * 0.55 + uSeed * 6.28);
    float raysB = 0.5 + 0.5 * sin(ang * 23.0 - uTime * 0.82 + uSeed * 11.4);
    float silk = mix(0.72, 1.18, raysA * 0.6 + raysB * 0.4);

    // 紧贴球体边缘升腾的奶油金大气日冕，外缘指数衰减不刺眼
    float innerRim = smoothstep(0.35, 0.46, r);
    float outerFade = pow(clamp(1.0 - (r - 0.42) / 0.58, 0.0, 1.0), 2.35);
    float halo = innerRim * outerFade * silk;

    vec3 cream = vec3(0.976, 0.945, 0.865);
    vec3 gold = vec3(0.955, 0.785, 0.465);
    vec3 col = mix(gold, cream, smoothstep(0.72, 0.43, r));
    col = mix(col, uCoronaColor, 0.35);

    float breath = 0.88 + 0.12 * sin(uTime * 1.6 + uSeed * 5.0);
    gl_FragColor = vec4(col * 0.92, halo * 0.52 * uAmount * breath);
  }
`;
