FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm install
COPY . .
RUN npm run prisma:generate && npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "server"]
