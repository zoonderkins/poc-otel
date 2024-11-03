FROM node:22-alpine

WORKDIR /app

# Copy shared files
COPY shared/ ./shared/

# Copy package files
COPY auth-service/package*.json ./

# Install dependencies
RUN npm install

# Copy service source code
COPY auth-service/ ./

# Expose the port
EXPOSE 3001

# Start the service
CMD ["npm", "start"] 