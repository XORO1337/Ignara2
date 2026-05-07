FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --no-frozen-lockfile
RUN pnpm build
EXPOSE 3001
CMD ["pnpm", "start"]
