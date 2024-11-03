FROM node:22-alpine

WORKDIR /app

# Copy shared files
COPY shared/ ./shared/

# Copy package files
COPY order-service/package*.json ./

# Install dependencies
RUN npm install

# Copy service source code
COPY order-service/ ./

# Expose the port
EXPOSE 3004

# Start the service
CMD ["npm", "start"] 