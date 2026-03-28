import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { MapsService } from "./maps.service";

@Controller("maps")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles()
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  private isDevUser(email?: string) {
    const configured = (process.env.DEV_USER_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    return !!email && configured.includes(email.toLowerCase());
  }

  private assertAdminOrDev(request: Request & { user?: { role?: string; email?: string } }) {
    const role = request.user?.role;
    const email = request.user?.email;
    if (role === "admin" || this.isDevUser(email)) {
      return;
    }

    throw new ForbiddenException("Only admin and dev users can access map editor endpoints");
  }

  private getOrgId(request: Request & { user?: { orgId: string } }) {
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new UnauthorizedException("Missing organization context");
    }
    return orgId;
  }

  @Get()
  list(@Req() request: Request & { user?: { orgId: string } }) {
    this.assertAdminOrDev(request as Request & { user?: { role?: string; email?: string } });
    return this.mapsService.listByOrg(this.getOrgId(request));
  }

  @Get(":id")
  getById(
    @Req() request: Request & { user?: { orgId: string } },
    @Param("id") id: string,
  ) {
    this.assertAdminOrDev(request as Request & { user?: { role?: string; email?: string } });
    return this.mapsService.getById(this.getOrgId(request), id);
  }

  @Post()
  save(
    @Req() request: Request & { user?: { orgId: string } },
    @Body()
    body: {
      id?: string;
      name: string;
      jsonConfig: Record<string, unknown>;
    },
  ) {
    this.assertAdminOrDev(request as Request & { user?: { role?: string; email?: string } });

    if (!body?.name || typeof body.jsonConfig !== "object" || body.jsonConfig === null) {
      throw new BadRequestException("Map payload must include name and jsonConfig");
    }

    const orgId = this.getOrgId(request);
    return this.mapsService.upsertMap({
      id: body.id,
      orgId,
      name: body.name,
      jsonConfig: body.jsonConfig,
    });
  }
}
