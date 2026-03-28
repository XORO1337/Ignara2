import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  orgId: string;
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
    return payload;
  }
}
