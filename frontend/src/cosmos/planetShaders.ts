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
  uniform vec3 uColorDark;
  uniform vec3 uRimColor;
  uniform float uHover;
  uniform float uBurst;
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

    float bands = sin(vLocalPos.y * (4.2 + uSeed * 5.0) + fbm(vLocalPos * 1.8 + uTime * 0.07) * 3.5);
    float continents = smoothstep(0.42, 0.62, fbm(vLocalPos * (2.4 + uSeed) + vec3(uSeed * 8.0)));
    float flow = fbm(vLocalPos * 3.1 + vec3(uTime * 0.045, uSeed, -uTime * 0.03));

    vec3 surface = mix(uColorB, uColorA, continents * 0.72 + flow * 0.28);
    surface = mix(surface, uColorA * 1.08, smoothstep(0.15, 0.85, bands) * 0.4);

    float ndl = dot(n, light);
    float terminator = smoothstep(-0.12, 0.28, ndl);
    vec3 lit = mix(uColorDark * 1.35, surface, terminator);
    lit += uColorA * pow(max(ndl, 0.0), 6.0) * 0.18;

    float fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 3.0);
    vec3 atmosphere = uRimColor * fresnel * (0.38 + uHover * 0.35 + uBurst * 0.7);

    vec3 col = lit * 0.92 + atmosphere;
    col += uRimColor * uBurst * 0.18;
    col = min(col, vec3(1.15));

    float alpha = 1.0;
    gl_FragColor = vec4(col, alpha);
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
  uniform float uHover;
  uniform float uBurst;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(vViewDir);
    float fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 3.0);
    float alpha = fresnel * (0.18 + uHover * 0.16 + uBurst * 0.28);
    gl_FragColor = vec4(uRimColor, alpha);
  }
`;
