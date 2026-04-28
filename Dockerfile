FROM node:18-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY data ./data
RUN npm run build
CMD ["node", "dist/index.js"]
