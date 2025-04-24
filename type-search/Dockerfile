# Base image with Node 16 and Puppeteer
FROM apify/actor-node-puppeteer:16

# Set working directory inside container
WORKDIR /home/myuser/app

# Copy package files and install dependencies first (for better caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy remaining project files
COPY . ./

# Run the actor using the start script
CMD ["npm", "start"]
