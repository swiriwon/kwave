FROM apify/actor-node-puppeteer-chrome:18-21.1.0

# Create app directory with proper permissions
WORKDIR /home/myuser/app
USER myuser

# Copy package.json before installing
COPY package*.json ./

# Install packages
RUN npm install puppeteer@21.1.1 --quiet --no-optional && \
    npm list || true

# Copy the rest of the app
COPY . .

# Set the working directory and default command
CMD ["node", "main.js"]
