import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { isDevAllowlistedEmail } from "../common/dev-user-allowlist";

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  orgId: string;
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
      isDevAllowlisted: isDevAllowlistedEmail(payload.email),
    };
  }
}
