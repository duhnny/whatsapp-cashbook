import { describe, expect, test } from '@jest/globals';
import { Role } from "../../prisma/client/enums.js";
import { userHasOneOfRoles, UserWithRoles } from "./auth.js";

describe('userHasOneOfRoles', () => {
  test('should return false when user has no roles', () => {
    const user: UserWithRoles = {
      roles: [],
    };

    const roles: Role[] = [Role.USER];

    expect(userHasOneOfRoles(user, roles)).toBe(false);
  });

  test('should return false when the roles to be matched are none', () => {
    const user: UserWithRoles = {
      roles: [Role.USER],
    };

    const roles: Role[] = [];

    expect(userHasOneOfRoles(user, roles)).toBe(false);
  });

  test('should return true when user has all roles', () => {
    const user: UserWithRoles = {
      roles: Object.values(Role),
    };

    const roles: Role[] = [Role.USER];

    expect(userHasOneOfRoles(user, roles)).toBe(true);
  });

  test('should return true when testing for all possible roles', () => {
    const user: UserWithRoles = {
      roles: [Role.USER],
    };

    const roles: Role[] = Object.values(Role);

    expect(userHasOneOfRoles(user, roles)).toBe(true);
  });

  test('should return true when user has exactly the role tested', () => {
    for (const role of Object.values(Role)) {
      const user: UserWithRoles = {
        roles: [role],
      };

      const roles: Role[] = [role];

      expect(userHasOneOfRoles(user, roles)).toBe(true);
    }
  });
});
