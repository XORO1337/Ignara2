import { AbilityBuilder, PureAbility, createMongoAbility } from "@casl/ability";
import type { Role } from "@ignara/sharedtypes";

type Actions = "manage" | "read" | "update" | "create";
type Subjects = "Map" | "Notification" | "Location" | "all";

export type AppAbility = PureAbility<[Actions, Subjects]>;

export class CaslAbilityFactory {
  createForRole(role: Role) {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (role === "admin") {
      can("manage", "all");
    }

    if (role === "manager") {
      can("read", "Map");
      can("read", "Location");
      can("create", "Notification");
    }

    if (role === "employee") {
      can("read", "Notification");
    }

    return build();
  }
}
