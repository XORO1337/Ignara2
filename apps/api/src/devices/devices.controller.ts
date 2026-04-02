import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { UsbDeviceConfigRequest } from "@ignara/sharedtypes";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { DevicesService } from "./devices.service";

type SessionUser = {
  orgId: string;
  role?: string;
  isDevAllowlisted?: boolean;
};

@Controller("devices")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "manager")
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  private assertAdminOrDev(request: Request & { user?: SessionUser }) {
    const role = request.user?.role;
    if (role === "admin" || request.user?.isDevAllowlisted) {
      return;
    }

    throw new ForbiddenException("Only admin and dev users can access USB configuration");
  }

  private getOrgId(request: Request & { user?: SessionUser }) {
    const orgId = request.user?.orgId;
    if (!orgId) {
      throw new UnauthorizedException("Missing organization context");
    }
    return orgId;
  }

  @Get("tags")
  listTags(@Req() request: Request & { user?: SessionUser }) {
    return this.devicesService.listTagsByOrg(this.getOrgId(request));
  }

  @Get("scanners")
  listScanners(@Req() request: Request & { user?: SessionUser }) {
    return this.devicesService.listScannersByOrg(this.getOrgId(request));
  }

  @Post("tags")
  registerTag(
    @Req() request: Request & { user?: SessionUser },
    @Body() body: { deviceId: string; roomId?: string },
  ) {
    const deviceId = body?.deviceId?.trim();
    const roomId = body?.roomId?.trim();

    if (!deviceId) {
      throw new BadRequestException("deviceId is required");
    }

    return this.devicesService.registerTag({
      orgId: this.getOrgId(request),
      deviceId,
      roomId: roomId || null,
    });
  }

  @Get("usb/targets")
  @Roles()
  async listUsbTargets(@Req() request: Request & { user?: SessionUser }) {
    this.assertAdminOrDev(request);
    const orgId = this.getOrgId(request);

    const [tags, scanners] = await Promise.all([
      this.devicesService.listTagsByOrg(orgId),
      this.devicesService.listScannersByOrg(orgId),
    ]);

    return { tags, scanners };
  }

  @Post("usb/commands/generate")
  @Roles()
  generateUsbCommands(
    @Req() request: Request & { user?: SessionUser },
    @Body() body: UsbDeviceConfigRequest,
  ) {
    this.assertAdminOrDev(request);

    if (!body?.deviceId?.trim()) {
      throw new BadRequestException("deviceId is required");
    }

    if (body.enablePasswordProtection && !body?.secureConfigPassword?.trim()) {
      throw new BadRequestException("secureConfigPassword is required when password protection is enabled");
    }

    return this.devicesService.generateUsbConfigCommands({
      orgId: this.getOrgId(request),
      request: {
        ...body,
        deviceId: body.deviceId.trim(),
        secureConfigPassword: body.secureConfigPassword?.trim(),
      },
    });
  }
}
