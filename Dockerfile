# Image Caddy légère et performante pour hébergement PWA Coolify
FROM caddy:2-alpine

# Copie de la configuration Caddy
COPY Caddyfile /etc/caddy/Caddyfile

# Copie des fichiers statiques de la PWA
COPY . /usr/share/caddy/

EXPOSE 80

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
