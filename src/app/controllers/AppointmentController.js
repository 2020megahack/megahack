import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours } from 'date-fns';
import pt from 'date-fns/locale/pt';
import Appointment from '../models/Appointment';
import User from '../models/User';
import File from '../models/File';
import Notification from '../schemas/Notification';


class AppointmentController {
  //metodo mostrar listagens de agendamentos para usuario logado
  async index(req, res) {
    const { page = 1 } = req.query;

    const appointments = await Appointment.findAll({
      where: {
        user_id: req.userId,
        canceled_at: null,
      },
      attributes: ['id', 'date', 'past', 'cancelable'],
      limit: 20, // lista 20 registros
      offset: (page - 1) * 20, // Quantos registro ele deve pular
      order: ['date'],
      include: [
        {
          model: User,
          as: 'provider', // O 'as' tem que ser igual ao valor que está model Appointment.js
          attributes: ['id', 'name'],
          include: [
            {
              model: File,
              as: 'avatar', // O 'as' tem que ser igual ao valor que está no model User
              attributes: ['id', 'path', 'url'],
            },
          ],
        },
      ],
    });
    return res.json(appointments);
  }
//criando agendamento
  async store(req, res) {
    const schema = Yup.object().shape({
      date: Yup.date().required(),
      provider_id: Yup.number().required(),
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Validation fails' });
    }

    const { provider_id, date } = req.body;

    // Verifica se provider_id é relamente de um provider

    if (provider_id === req.userId) {
      return res.status().json({ error: 'Provider and user are the same' });
    }

    const isProvider = await User.findOne({
      where: { id: provider_id, provider: true },
    });

    if (!isProvider) {
      return res
        .status(401)
        .json({ error: 'Voce pode criar agendamentos apenas com especialistas' });
    }
    // checando hora passada
    const hourStart = startOfHour(parseISO(date));

    if (isBefore(hourStart, new Date())) {
      return res.status(400).json({ error: 'Datas passadas nao sao permitidas' });
    }

    // Checar se agendamento esta disponivel

    const checkAvailability = await Appointment.findOne({
      where: {
        provider_id,
        canceled_at: null,
        date: hourStart,
      },
    });

    if (checkAvailability) {
      return res
        .status(400)
        .json({ error: 'Agendamento indisponivel' });
    }

    // return res.json(date);
    const appointment = await Appointment.create({
      user_id: req.userId,
      provider_id,
      date,
    });

    const user = await User.findByPk(req.userId);
    const formattedDate = format(
      hourStart,
      "'dia' dd 'de' MMMM', às' H:mm'h'",
      {
        locale: pt,
      }
    );
    // NOTIFICAR AGENDAMENTO AO ESPECIALISTA
    await Notification.create({
      content: `Novo agendamento de ${user.name} para ${formattedDate}`,
      user: provider_id,
    });

    return res.json(appointment);
  }
  //cancelAR AGENDAMENTO ate 2 horas antes do horario agendado
  async delete(req, res) {
    const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email'],
        },
        {
          model: User,
          as: 'user',
          attributes: ['name'],
        },
      ],
    });
   //verificar se agendamento possui ao usuario
    if (appointment.user_id !== req.userId) {
      return res.json(401).json({
        error: 'Voce nao tem permissao para cancelar este agendamento',
      });
    }

    const dateWithSub = subHours(appointment.date, 2);
    // tira 2h do horario do compromisso
    // appointment.date = 13h
    // dateWithSub = 11h
    // new Date() = 12h
    //    NÃO PODE CANCELAR
    // new Date() = 10h
    //    PODE CANCELAR
    if (isBefore(dateWithSub, new Date())) {
      return res.status(401).json({
        error: 'Voce so pode cancelar 2 horas antes do agendamento',
      });
    }

    appointment.canceled_at = new Date();

    await appointment.save();

    

    return res.json(appointment);
  }
}

export default new AppointmentController();
