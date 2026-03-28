import { Controller, Get, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { LocationsService } from "./locations.service";

type SessionUser = {
  orgId: string;
  role: "admin" | "manager" | "employee";
};

@Controller("locations")
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get("current")
  @UseGuards(RolesGuard)
  @Roles("admin", "manager")
  getCurrent(@Req() request: Request & { user?: SessionUser }) {
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new UnauthorizedException("Missing organization context");
    }

    return this.locationsService.getCurrentByOrg(orgId);
  }
}