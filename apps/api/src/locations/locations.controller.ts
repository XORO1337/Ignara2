import { BadRequestException, Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { LocationMoveRequest, ScannerLocationEvent } from "@ignara/sharedtypes";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { LocationsService } from "./locations.service";

type SessionUser = {
  orgId: string;
  email: string;
  role: "admin" | "manager" | "employee";
};

@Controller("locations")
@UseGuards(JwtAuthGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get("current")
  @UseGuards(RolesGuard)
  @Roles("admin", "manager", "employee")
  getCurrent(@Req() request: Request & { user?: SessionUser }) {
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new UnauthorizedException("Missing organization context");
    }

    return this.locationsService.getCurrentByOrg(orgId);
  }

  @Post("move")
  @UseGuards(RolesGuard)
  @Roles("employee")
  move(
    @Req() request: Request & { user?: SessionUser },
    @Body() body: LocationMoveRequest,
  ) {
    const orgId = request.user?.orgId;
    const employeeId = request.user?.email;

    if (!orgId || !employeeId) {
      throw new UnauthorizedException("Missing organization context");
    }

    if (!Number.isFinite(body?.x) || !Number.isFinite(body?.y)) {
      throw new BadRequestException("x and y must be valid numbers");
    }

    return this.locationsService.movePlayer({
      orgId,
      employeeId,
      x: Number(body.x),
      y: Number(body.y),
      roomId: body.roomId?.trim() || undefined,
    });
  }

  @Post("ingest")
  @UseGuards(RolesGuard)
  @Roles("admin", "manager")
  async ingest(
    @Req() request: Request & { user?: SessionUser },
    @Body() body: Partial<ScannerLocationEvent>,
  ) {
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new UnauthorizedException("Missing organization context");
    }

    await this.locationsService.ingestScannerEvent({
      ...body,
      orgId: body?.orgId?.trim() || orgId,
      sourceType: "ble",
    });

    return { ok: true };
  }
}
