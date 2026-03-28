FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY tsconfig.json ./
COPY next.config.mjs ./
COPY postcss.config.mjs ./
COPY tailwind.config.ts ./
COPY src ./src
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --no-frozen-lockfile
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
