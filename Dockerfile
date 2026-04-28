FROM node:18-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
RUN mkdir -p src data
COPY index.ts ./src/index.ts
COPY sales.json ./data/sales.json
RUN npm run build
CMD ["node", "dist/index.js"]
