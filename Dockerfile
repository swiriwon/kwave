FROM apify/actor-node-puppeteer-chrome:18-21.1.0

# Set working directory (Apify actor base image uses /usr/src/app)
WORKDIR /usr/src/app

# Copy only package.json for clean install
COPY package.json package-lock.json* ./

# Fix permission issue
USER root

# Install puppeteer manually
RUN npm install puppeteer@21.1.1 --no-optional --quiet

# Copy the rest of the code
COPY . ./

# Ensure actor starts correctly
CMD ["npm", "start"]
