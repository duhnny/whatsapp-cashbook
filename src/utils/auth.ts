import { Role } from "../../prisma/client/enums.js"

interface UserWithRoles {
  roles: Role[]
}
export const userHasOneOfRoles = (user: UserWithRoles, roles: Role[]) => {
  return roles.some(role => user.roles.includes(role));
}
