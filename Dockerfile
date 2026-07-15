FROM node:20-alpine

WORKDIR /app

# 复制 package 文件（应该在根目录）
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com
RUN npm install
RUN npm install swagger-jsdoc swagger-ui-express

# 复制 prisma 目录
COPY prisma ./prisma
RUN npx prisma generate

# 复制 tsconfig.json
COPY tsconfig.json ./

# 👇 关键修改：复制 src 目录（而不是 backend/src）
COPY src ./src

EXPOSE 3000

CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && npm run dev"]