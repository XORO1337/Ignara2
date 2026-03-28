import { BadRequestException, Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { NotificationPayload } from "@ignara/sharedtypes";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { NotificationsService } from "./notifications.service";

type SessionUser = {
  sub: string;
  orgId: string;
};

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  private getSessionUser(request: Request & { user?: SessionUser }) {
    const sessionUser = request.user;
    if (!sessionUser?.orgId || !sessionUser?.sub) {
      throw new UnauthorizedException("Missing user session context");
    }
    return sessionUser;
  }

  private validatePayload(payload: Pick<NotificationPayload, "message" | "priority">) {
    const validPriority = payload?.priority === "low" || payload?.priority === "normal" || payload?.priority === "high";
    if (!payload?.message || !validPriority) {
      throw new BadRequestException("Notification payload must include message and valid priority");
    }
  }

  @Get()
  list(
    @Req() request: Request & { user?: SessionUser },
    @Query("limit") limit?: string,
  ) {
    const orgId = this.getSessionUser(request).orgId;
    const parsed = Number.parseInt(limit ?? "50", 10);
    return this.notificationsService.listByOrg(orgId, Number.isNaN(parsed) ? 50 : parsed);
  }

  @Post("targeted")
  @UseGuards(RolesGuard)
  @Roles("admin", "manager")
  sendTargeted(
    @Req() request: Request & { user?: SessionUser },
    @Body() payload: NotificationPayload,
  ) {
    const sessionUser = this.getSessionUser(request);
    this.validatePayload(payload);
    if (!payload.recipientIds || payload.recipientIds.length === 0) {
      throw new BadRequestException("Targeted notifications require at least one recipientId");
    }

    const normalizedPayload: NotificationPayload = {
      orgId: sessionUser.orgId,
      senderId: sessionUser.sub,
      message: payload.message,
      priority: payload.priority,
      recipientIds: payload.recipientIds,
    };

    return this.notificationsService.sendTargeted(normalizedPayload);
  }

  @Post("broadcast")
  @UseGuards(RolesGuard)
  @Roles("admin", "manager")
  sendBroadcast(
    @Req() request: Request & { user?: SessionUser },
    @Body() payload: NotificationPayload,
  ) {
    const sessionUser = this.getSessionUser(request);
    this.validatePayload(payload);

    const normalizedPayload: NotificationPayload = {
      orgId: sessionUser.orgId,
      senderId: sessionUser.sub,
      message: payload.message,
      priority: payload.priority,
      recipientIds: undefined,
    };

    return this.notificationsService.sendBroadcast(normalizedPayload);
  }
}
