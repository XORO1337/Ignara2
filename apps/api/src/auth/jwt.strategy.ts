import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { UserRestrictions, UserStatus } from "@ignara/sharedtypes";
import { isDevAllowlistedEmail } from "../common/dev-user-allowlist";

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  gender?: "male" | "female" | "other";
  orgId: string;
  status?: UserStatus;
  restrictions?: UserRestrictions;
  isDevAllowlisted?: boolean;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => request?.cookies?.ignara_access,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET ?? "replace-me",
    });
  }

  async validate(payload: JwtPayload) {
    return {
      ...payload,
      gender: payload.gender ?? "other",
      status: payload.status ?? "active",
      restrictions: payload.restrictions ?? {},
      isDevAllowlisted: isDevAllowlistedEmail(payload.email),
    };
  }
}
