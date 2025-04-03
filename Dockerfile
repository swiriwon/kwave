FROM apify/actor-node-puppeteer-chrome:18-21.1.0

# Create the app folder and set permissions
USER root
RUN mkdir -p /home/myuser/app && chown -R myuser:myuser /home/myuser/app

# Switch to app folder and user
WORKDIR /home/myuser/app
USER myuser

# Copy package files and install only production deps
COPY package*.json ./
RUN npm install --quiet --omit=dev --no-optional && npm list || true

# Copy the rest of the app code
COPY . .

# Start the app
CMD ["node", "main.js"]
