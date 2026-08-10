# InferX solution sizing tool — static site served by nginx.
# The app is plain HTML/CSS/JS with no build step, so there is nothing to compile.

FROM nginx:1.27-alpine

# Drop the default site and install our config.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/app.conf
COPY security-headers.conf /etc/nginx/security-headers.conf

# Application files.
WORKDIR /usr/share/nginx/html
COPY index.html rack.html compute.html wizard.html \
     styles.css rack.css wizard.css \
     catalog.js sizing.js app.js rack.js \
     compute-catalog.js inference.js compute-app.js ra-rack.js wizard.js ./

# nginx:alpine ships an unprivileged `nginx` user. Running as non-root means the
# container cannot bind ports below 1024, hence port 8080 rather than 80.
RUN chown -R nginx:nginx /usr/share/nginx/html \
    && touch /var/run/nginx.pid \
    && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
