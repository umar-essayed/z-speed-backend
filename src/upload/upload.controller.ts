import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { SuperTokensAuthGuard } from '../common/guards/auth.guard';

@Controller('upload')
@UseGuards(SuperTokensAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB limit
      },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpg|jpeg|png|gif|webp|heic|heif)$/) && 
            file.mimetype !== 'application/pdf') {
          return cb(new BadRequestException('Only images and PDF files are allowed!'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const url = await this.uploadService.uploadFile(file, folder || 'uploads');
    return { url };
  }
}
