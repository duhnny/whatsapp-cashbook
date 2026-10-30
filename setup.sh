#!/bin/bash
set -e

# for loading environment variables
function load() {
    . ./utils/scripts/loadenv.sh < "$1"
}
function unload() {
    . ./utils/scripts/unloadenv.sh < "$1"
}

# load env variables from .env file
load .env

# check if docker stack name is setup correctly
if [[ -v DOCKER_STACK_NAME ]]; then
    if docker stack ls | grep -q "$DOCKER_STACK_NAME"; then
        echo stack with name "$DOCKER_STACK_NAME" already exists
        exit 1
    fi
else
    echo please set your stack name in the .env file
    exit 1
fi

# download necessary images
echo "-> building images"

docker build -t 'localhost/whatsapp-cashbook' . &> /dev/null

echo "-> image built"

# check necessary networks
echo "-> checking networks"

if docker network ls | grep -q "${DB_NETWORK}"; then
    echo "-> db network exists"
else
    unload .env
    echo "ERROR: db network does not exist. Exiting."
    exit 1
fi

if docker network ls | grep -q "${WHATSAPP_NETWORK}"; then
    echo "-> whatsapp network exists"
else
    unload .env
    echo "ERROR: whatsapp network does not exist. Exiting."
    exit 1
fi

# do the cleanup
echo "-> cleaning up"

unload .env

echo "-> setup complete!"
exit
