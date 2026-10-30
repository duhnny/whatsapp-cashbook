set -e

. ./utils/scripts/loadenv.sh < .env

docker stack down "${DOCKER_STACK_NAME}"

. ./utils/scripts/unloadenv.sh < .env
