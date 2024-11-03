FROM node:22-alpine

WORKDIR /app

# Copy shared files
COPY shared/ ./shared/

# Copy package files
COPY cart-service/package*.json ./

# Install dependencies
RUN npm install

# Copy service source code
COPY cart-service/ ./

# Expose the port
EXPOSE 3003

# Start the service
CMD ["npm", "start"] 