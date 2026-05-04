# Base stage for dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for some npm packages
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies including devDependencies for build
RUN npm install

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the app
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# Railway will override CMD if needed, but this is a good default
CMD ["npx", "prisma", "db", "push", "&&", "npm", "run", "start:prod"]
