FROM node:22-alpine

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Clean install dependencies
RUN rm -rf node_modules && \
    npm cache clean --force && \
    npm install

# Copy source code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 