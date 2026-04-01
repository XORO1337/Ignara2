import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UsersService } from "../users/users.service";
import { isDevAllowlistedEmail } from "../common/dev-user-allowlist";
import { hashPassword, needsPasswordUpgrade, verifyPassword } from "./password";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user || !verifyPassword(user.password, password)) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (needsPasswordUpgrade(user.password)) {
      await this.usersService.updatePassword(user.id, hashPassword(password));
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      isDevAllowlisted: isDevAllowlistedEmail(user.email),
    };

    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, user: payload };
  }

  async validateUser(id: string) {
    return this.usersService.findById(id);
  }
}
