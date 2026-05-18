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
    @Body('customerId') customerId: string,
    @Body('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    
    // Use a safe folder under the user namespace
    const safeFolder = folder ?? (customerId ? `users/${customerId}/prescriptions` : 'uploads');
    const url = await this.uploadService.uploadFile(file, safeFolder);
    return { url };
  }

  @Post('base64')
  async uploadBase64(
    @Body('fileBase64') fileBase64: string,
    @Body('fileName') fileName: string,
    @Body('customerId') customerId?: string,
    @Body('folder') folder?: string,
  ) {
    if (!fileBase64 || !fileName) {
      throw new BadRequestException('fileBase64 and fileName are required');
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    
    // Construct a faux file object to pass to uploadService
    const fauxFile = {
      buffer,
      originalname: fileName,
      mimetype: 'application/octet-stream', // Could map extensions if needed, but not strictly required
    } as Express.Multer.File;

    const safeFolder = folder ?? (customerId ? `users/${customerId}/prescriptions` : 'uploads');
    const url = await this.uploadService.uploadFile(fauxFile, safeFolder);
    return { url };
  }
}
