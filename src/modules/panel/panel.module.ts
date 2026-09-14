import { Module } from '@nestjs/common';
import { PanelService } from './panel.service';
import { PanelController } from './panel.controller';

@Module({
  providers: [PanelService],
  controllers: [PanelController],
  exports: [PanelService],
})
export class PanelModule {}
