set -e

# load .env file
. ./utils/scripts/loadenv.sh < .env

# run stack
docker stack up \
    --compose-file=$DOCKER_COMPOSE_FILE \
    --detach=true \
    $DOCKER_STACK_NAME

# unload .env file
. ./utils/scripts/unloadenv.sh < .env
