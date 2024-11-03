FROM node:22-alpine

WORKDIR /app

# Copy shared files
COPY shared/ ./shared/

# Copy package files
COPY product-service/package*.json ./

# Install dependencies
RUN npm install

# Copy service source code
COPY product-service/ ./

# Expose the port
EXPOSE 3002

# Start the service
CMD ["npm", "start"] 