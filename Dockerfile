USER root
RUN rm -rf /home/myuser/node_modules
RUN mkdir -p /home/myuser/app && chown -R myuser:myuser /home/myuser/app
