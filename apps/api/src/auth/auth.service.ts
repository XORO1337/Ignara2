import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import { OrganizationEntity } from "../entities/organization.entity";
import { UsersService } from "../users/users.service";
import { isDevAllowlistedEmail } from "../common/dev-user-allowlist";
import { hashPassword, needsPasswordUpgrade, verifyPassword } from "./password";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepository: Repository<OrganizationEntity>,
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
      gender: user.gender ?? "other",
      orgId: user.orgId,
      isDevAllowlisted: isDevAllowlistedEmail(user.email),
    };

    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, user: payload };
  }

  async signup(email: string, password: string, role: "admin" | "manager" | "employee" = "employee") {
    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new BadRequestException("An account with this email already exists");
    }

    // Find or create a default organization
    let org = await this.orgRepository.findOne({ where: { name: "Ignara Demo Org" } });
    if (!org) {
      org = this.orgRepository.create({ id: randomUUID(), name: "Ignara Demo Org" });
      await this.orgRepository.save(org);
    }

    const userId = randomUUID();
    const hashedPassword = hashPassword(password);

    await this.usersService.create({
      id: userId,
      email,
      password: hashedPassword,
      role,
      gender: "other",
      orgId: org.id,
    });

    const payload = {
      sub: userId,
      email,
      role,
      gender: "other" as const,
      orgId: org.id,
      isDevAllowlisted: isDevAllowlistedEmail(email),
    };

    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, user: payload };
  }

  async validateUser(id: string) {
    return this.usersService.findById(id);
  }
}
