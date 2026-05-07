import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { UserRestrictions, UserStatus } from "@ignara/sharedtypes";
import { randomUUID } from "node:crypto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { hashPassword } from "../auth/password";
import { UsersService } from "./users.service";

type SessionUser = {
  sub: string;
  orgId: string;
  role?: string;
};

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private getSession(request: Request & { user?: SessionUser }) {
    const session = request.user;
    if (!session?.orgId || !session?.sub) {
      throw new UnauthorizedException("Missing organization context");
    }
    return session;
  }

  @Get()
  list(@Req() request: Request & { user?: SessionUser }) {
    return this.usersService.listByOrg(this.getSession(request).orgId);
  }

  // ── Admin-only: create a new user ──────────────────────────────────
  @Post()
  @UseGuards(RolesGuard)
  @Roles("admin")
  async createUser(
    @Req() request: Request & { user?: SessionUser },
    @Body() body: {
      email?: string;
      password?: string;
      role?: "admin" | "manager" | "employee";
      gender?: "male" | "female" | "other";
    },
  ) {
    const session = this.getSession(request);
    const email = body?.email?.trim();
    const password = body?.password?.trim();

    if (!email || !password) {
      throw new BadRequestException("Email and password are required");
    }

    if (password.length < 6) {
      throw new BadRequestException("Password must be at least 6 characters");
    }

    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new BadRequestException("An account with this email already exists");
    }

    const user = await this.usersService.create({
      id: randomUUID(),
      email,
      password: hashPassword(password),
      role: body.role ?? "employee",
      gender: body.gender ?? "other",
      orgId: session.orgId,
    });

    return {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      role: user.role,
      gender: user.gender,
      tagDeviceId: user.tagDeviceId,
      status: user.status,
      restrictions: user.restrictions,
    };
  }

  // ── Admin-only: update user details ────────────────────────────────
  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async updateUser(
    @Req() request: Request & { user?: SessionUser },
    @Param("id") userId: string,
    @Body() body: {
      email?: string;
      password?: string;
      role?: "admin" | "manager" | "employee";
      gender?: "male" | "female" | "other";
      tagDeviceId?: string | null;
      status?: UserStatus;
      restrictions?: UserRestrictions;
    },
  ) {
    const session = this.getSession(request);

    // Prevent admins from banning themselves
    if (userId === session.sub && body.status === "banned") {
      throw new ForbiddenException("You cannot ban your own account");
    }

    const updates: Parameters<UsersService["updateUser"]>[2] = {};

    if (body.email !== undefined) {
      const trimmed = body.email.trim();
      if (!trimmed) {
        throw new BadRequestException("Email cannot be empty");
      }

      const existing = await this.usersService.findByEmail(trimmed);
      if (existing && existing.id !== userId) {
        throw new BadRequestException("An account with this email already exists");
      }
      updates.email = trimmed;
    }

    if (body.password !== undefined) {
      const trimmed = body.password.trim();
      if (trimmed.length < 6) {
        throw new BadRequestException("Password must be at least 6 characters");
      }
      updates.password = hashPassword(trimmed);
    }

    if (body.role !== undefined) updates.role = body.role;
    if (body.gender !== undefined) updates.gender = body.gender;
    if (body.tagDeviceId !== undefined) updates.tagDeviceId = body.tagDeviceId;
    if (body.status !== undefined) updates.status = body.status;
    if (body.restrictions !== undefined) updates.restrictions = body.restrictions;

    return this.usersService.updateUser(userId, session.orgId, updates);
  }

  // ── Admin-only: delete user ────────────────────────────────────────
  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles("admin")
  async deleteUser(
    @Req() request: Request & { user?: SessionUser },
    @Param("id") userId: string,
  ) {
    const session = this.getSession(request);

    if (userId === session.sub) {
      throw new ForbiddenException("You cannot delete your own account");
    }

    return this.usersService.deleteUser(userId, session.orgId);
  }
}
