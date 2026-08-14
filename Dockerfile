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

# Default start command for the FlowPay API web service.
# The background worker must use Dockerfile.worker or explicitly override this command.
CMD ["npm", "run", "start", "--workspace", "@flowpay/api"]
