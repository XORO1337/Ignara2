/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      canvas: false,
      "konva/lib/index-node.js": "konva/lib/index.js",
    };
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      canvas: false,
    };

    if (isServer) {
      config.externals = [...(config.externals ?? []), { canvas: "commonjs canvas" }];
    }

    return config;
  },
};

export default nextConfig;
