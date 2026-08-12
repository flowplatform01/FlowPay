FROM node:20-alpine AS base
WORKDIR /app

# Copy root and package dependencies
COPY package*.json ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps

# Install dependencies and build API package
RUN npm ci
RUN npm run build --workspace @flowpay/api

# Default start command for worker (can be overridden in Northflank/Render)
CMD ["npm", "run", "start:worker", "--workspace", "@flowpay/api"]
