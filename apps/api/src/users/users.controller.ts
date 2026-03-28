import { Controller, Get, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private getOrgId(request: Request & { user?: { orgId: string } }) {
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new UnauthorizedException("Missing organization context");
    }
    return orgId;
  }

  @Get()
  list(@Req() request: Request & { user?: { orgId: string } }) {
    return this.usersService.listByOrg(this.getOrgId(request));
  }
}
