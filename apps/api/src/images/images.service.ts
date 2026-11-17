import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { ProjectsService } from '../projects/projects.service.js';
import { hostPath } from '../projects/workspace.js';
import {
  IMAGE_FILE_RE,
  MAX_CAPTION,
  MAX_IMAGE_BYTES,
  MAX_USER_IMAGES,
  imageBaseName,
  listImages,
  readCaptions,
  sniffImage,
  writeCaptions,
  type ProjectImage,
} from './images.store.js';

/**
 * A project's images: the user's own uploads and the stock photos Hermes fetched.
 * They live in the project's images/ folder, so versions, restore and publish include them.
 */
@Injectable()
export class ImagesService {
  constructor(private readonly projects: ProjectsService) {}

  async list(userId: string, projectId: string): Promise<ProjectImage[]> {
    const project = await this.projects.getOwned(userId, projectId);
    return listImages(hostPath(project.folder));
  }

  /** Saves an uploaded image. Its type is read from its bytes; its name is made safe. */
  async upload(userId: string, projectId: string, name: string, caption: string, data: Buffer): Promise<ProjectImage> {
    const project = await this.projects.getOwned(userId, projectId);
    await this.projects.assertIdle(project.id, 'changed');
    if (data.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeException('Images can be at most 5 MB each.');
    const type = sniffImage(data);
    if (!type) throw new BadRequestException('Only JPG, PNG, WebP and GIF images can be added.');

    const dir = hostPath(project.folder);
    const existing = await listImages(dir);
    const captions = await readCaptions(dir);
    if (Object.keys(captions).length >= MAX_USER_IMAGES) {
      throw new BadRequestException(`A project can have at most ${MAX_USER_IMAGES} of your own images. Remove one first.`);
    }
    const taken = new Set(existing.map((i) => i.file));
    const base = imageBaseName(name);
    let file = `${base}.${type}`;
    for (let n = 2; taken.has(file); n += 1) file = `${base}-${n}.${type}`;

    await mkdir(path.join(dir, 'images'), { recursive: true });
    await writeFile(path.join(dir, 'images', file), data);
    captions[file] = caption.replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
    await writeCaptions(dir, captions);
    await this.commit(dir, `images: add ${file}`);
    return { file, caption: captions[file], stock: false, size: data.length };
  }

  /** Changes the description Hermes is given for one of the user's images. */
  async setCaption(userId: string, projectId: string, file: string, caption: string): Promise<ProjectImage> {
    const project = await this.projects.getOwned(userId, projectId);
    await this.projects.assertIdle(project.id, 'changed');
    const dir = hostPath(project.folder);
    const image = (await this.find(dir, file));
    const captions = await readCaptions(dir);
    captions[file] = caption.replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
    await writeCaptions(dir, captions);
    await this.commit(dir, `images: describe ${file}`);
    return { ...image, caption: captions[file], stock: false };
  }

  /** Removes an image file. A page that still uses it will show a broken image until it is rebuilt. */
  async remove(userId: string, projectId: string, file: string): Promise<void> {
    const project = await this.projects.getOwned(userId, projectId);
    await this.projects.assertIdle(project.id, 'changed');
    const dir = hostPath(project.folder);
    await this.find(dir, file);
    await rm(path.join(dir, 'images', file), { force: true });
    const captions = await readCaptions(dir);
    if (file in captions) {
      delete captions[file];
      await writeCaptions(dir, captions);
    }
    await this.commit(dir, `images: remove ${file}`);
  }

  private async find(dir: string, file: string): Promise<ProjectImage> {
    // The pattern allows no slashes or dots other than the extension, so the path stays in images/.
    if (!IMAGE_FILE_RE.test(file)) throw new NotFoundException('Image not found');
    const image = (await listImages(dir)).find((i) => i.file === file);
    if (!image) throw new NotFoundException('Image not found');
    return image;
  }

  /**
   * Images are committed to the project's git history straight away (so a prompt edit's
   * clean-up or a restore never loses them), but without a Version row: only changes to the
   * site itself count as versions.
   */
  private async commit(dir: string, message: string): Promise<void> {
    const git = simpleGit(dir);
    await git.add(['-A']);
    await git.commit(message, [], { '--allow-empty': null });
  }
}
